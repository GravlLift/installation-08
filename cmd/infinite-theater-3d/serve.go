package main

// serve.go — the `serve` subcommand: an HTTP server (standard library only) over the local
// store. It binds to loopback by default and serves the match list, a match's replay
// document (gzip as stored, or decompressed), and a map's mesh (range-capable).

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// Version is the build version served by /api/health.
const Version = "0.1.0"

// serveFlags is the parsed form of the `serve` arguments.
type serveFlags struct {
	addr    string
	web     string
	dataDir string
}

// parseServeFlags turns `serve` arguments into serveFlags.
func parseServeFlags(args []string) (serveFlags, error) {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	var f serveFlags
	fs.StringVar(&f.addr, "addr", "127.0.0.1:8177", "listen address (loopback by default)")
	fs.StringVar(&f.web, "web", "", "directory of static files to serve for non-API paths (optional)")
	fs.StringVar(&f.dataDir, "data", "", "data directory (default: IT3D_DATA_DIR or %LOCALAPPDATA%/infinite-theater-3d/data)")
	err := fs.Parse(args)
	if err != nil {
		return f, err
	}
	return f, nil
}

// runServe starts the HTTP server and blocks until a cancellation signal, then shuts it
// down cleanly.
func runServe(args []string) error {
	f, err := parseServeFlags(args)
	if err != nil {
		return err
	}
	dataDir, err := dataDirFor(f.dataDir)
	if err != nil {
		return err
	}
	root, err := store.New(dataDir)
	if err != nil {
		return err
	}
	h := newServerHandlers(root, f.web)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ln, err := net.Listen("tcp", f.addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", f.addr, err)
	}
	srv := &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
	}
	errCh := make(chan error, 1)
	go func() {
		slog.Info("infinite-theater-3d serving", "addr", f.addr, "data", dataDir)
		errCh <- srv.Serve(ln)
	}()
	select {
	case <-ctx.Done():
		slog.Info("shutting down")
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return fmt.Errorf("serve: %w", err)
		}
	}
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return srv.Shutdown(shutdownCtx)
}

// serverHandlers bundles the store and the optional static directory. It implements
// http.Handler: ServeHTTP serves the static files for non-API paths and the mux for the
// API routes.
type serverHandlers struct {
	root *store.Root
	web  string
	mux  *http.ServeMux
}

// ServeHTTP routes a request: a static file when the web directory serves it, otherwise
// the API mux.
func (h serverHandlers) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.servesStatic(r) {
		h.serveStatic(w, r)
		return
	}
	h.mux.ServeHTTP(w, r)
}

// newServerHandlers builds the server: the API routes on a mux, wrapped by the static
// fallback. It returns the concrete handler (which implements http.Handler) so a test can
// drive the routes directly as well as through the full server.
func newServerHandlers(root *store.Root, web string) serverHandlers {
	h := serverHandlers{root: root, web: web}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", h.handleHealth)
	mux.HandleFunc("GET /api/matches", h.handleMatches)
	mux.HandleFunc("GET /api/matches/{id}/replay", h.handleReplay)
	mux.HandleFunc("GET /api/matches/{id}/mesh.glb", h.handleMesh)
	h.mux = mux
	return h
}

// servesStatic says whether the path is one the static directory answers (any path that is
// not an API route and not a method the API uses on an API path).
func (h serverHandlers) servesStatic(r *http.Request) bool {
	if h.web == "" {
		return false
	}
	if strings.HasPrefix(r.URL.Path, "/api/") {
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	raw, err := json.Marshal(v)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(append(raw, '\n'))
}

// handleHealth answers /api/health.
func (h serverHandlers) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true", "version": Version})
}

// handleMatches answers /api/matches with the match summaries, newest first.
func (h serverHandlers) handleMatches(w http.ResponseWriter, r *http.Request) {
	ms, err := h.root.ListMatches()
	if err != nil {
		slog.Error("list matches", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if ms == nil {
		ms = []store.Match{}
	}
	writeJSON(w, http.StatusOK, ms)
}

// handleReplay answers /api/matches/{id}/replay with the document: gzip-encoded as stored
// when the client accepts it, otherwise decompressed.
func (h serverHandlers) handleReplay(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid match id"})
		return
	}
	raw, err := h.root.LoadReplay(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found", "id": id})
			return
		}
		slog.Error("load replay", "err", err, "id", id)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	acceptsGzip := strings.Contains(r.Header.Get("Accept-Encoding"), "gzip")
	if acceptsGzip {
		w.Header().Set("Content-Encoding", "gzip")
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Vary", "Accept-Encoding")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(raw) // already gzip
		return
	}
	doc, err := gunzipBytes(raw)
	if err != nil {
		slog.Error("replay not gzip", "err", err, "id", id)
		w.Header().Set("Content-Type", "application/octet-stream")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(raw) // serve as-is if it is not gzip
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(doc)
}

// handleMesh answers /api/matches/{id}/mesh.glb with the map's geometry (range-capable via
// http.ServeContent); a missing mesh is a JSON 404 naming the module key.
func (h serverHandlers) handleMesh(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid match id"})
		return
	}
	meta, err := h.root.MatchMeta(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found", "id": id})
			return
		}
		slog.Error("match meta", "err", err, "id", id)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if meta.MapModule == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "mesh_not_built", "moduleKey": ""})
		return
	}
	path, err := h.root.MeshPath(meta.MapModule)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "mesh_not_built", "moduleKey": meta.MapModule})
		return
	}
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "mesh_not_built", "moduleKey": meta.MapModule})
			return
		}
		slog.Error("open mesh", "err", err, "module", meta.MapModule)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer file.Close()
	http.ServeContent(w, r, "mesh.glb", time.Time{}, file)
}

// serveStatic serves a file from the web directory, falling back to index.html for a path
// with no file (the single-page-app convention). A request that would escape the web
// directory (a .. segment) is refused.
func (h serverHandlers) serveStatic(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/")
	if name == "" {
		name = "index.html"
	}
	candidate, ok := joinInside(h.web, name)
	if !ok {
		http.NotFound(w, r)
		return
	}
	if _, err := os.Stat(candidate); err == nil {
		http.ServeFile(w, r, candidate)
		return
	}
	if index, ok := joinInside(h.web, "index.html"); ok {
		if _, err := os.Stat(index); err == nil {
			http.ServeFile(w, r, index)
			return
		}
	}
	http.NotFound(w, r)
}

// joinInside joins web and name and says whether the result stays inside web (a cleaned
// path that would climb out of web is refused, so no request can read a file above it).
func joinInside(web, name string) (string, bool) {
	webRoot, err := filepath.Abs(filepath.Clean(web))
	if err != nil {
		return "", false
	}
	full := filepath.Join(webRoot, filepath.Clean(name))
	if full != webRoot && !strings.HasPrefix(full, webRoot+string(os.PathSeparator)) {
		return "", false
	}
	return full, true
}

// gunzipBytes decompresses a gzip byte slice.
func gunzipBytes(raw []byte) ([]byte, error) {
	gr, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return nil, err
	}
	defer gr.Close()
	return io.ReadAll(gr)
}
