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
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// Version is the build version served by /api/health.
const Version = "0.1.0"

// serveFlags is the parsed form of the `serve` arguments.
type serveFlags struct {
	addr    string
	web     string
	dataDir string
	game    string
	mapKey  string
}

// parseServeFlags turns `serve` arguments into serveFlags.
func parseServeFlags(args []string) (serveFlags, error) {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	var f serveFlags
	fs.StringVar(&f.addr, "addr", "127.0.0.1:8177", "listen address (loopback by default)")
	fs.StringVar(&f.web, "web", "", "directory of static files to serve for non-API paths (optional)")
	fs.StringVar(&f.dataDir, "data", "", "data directory (default: IT3D_DATA_DIR or %LOCALAPPDATA%/infinite-theater-3d/data)")
	fs.StringVar(&f.game, "game", "", "game deploy root for map and weapon builds (empty auto-detects)")
	fs.StringVar(&f.mapKey, "map", "", "installed map whose module index weapon builds open (default: first map in the data store)")
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
	weaponKeys := weaponCatalogFor(root, f.mapKey)
	jobs, err := meshJobsFor(root, f.game, weaponKeys)
	if err != nil {
		return err
	}
	jobs.Start()
	defer jobs.Stop(5 * time.Second)
	maybeEnqueueWeaponIcons(jobs, dataDir, f.game)
	labelCat, err := weapons.LoadLabelCatalog()
	if err != nil {
		return err
	}
	h := newServerHandlers(root, f.web, jobs, weaponKeys, labelCat)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	ln, err := net.Listen("tcp", f.addr)
	if err != nil {
		return fmt.Errorf("listen %s: %w", f.addr, err)
	}
	// A pending device-code login dies with the server (its wait fires, the session ends
	// failed; no goroutine is left polling Microsoft).
	defer h.stopPendingLogin()
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

// serverHandlers bundles the store, the optional static directory, the mesh build runner,
// the weapon model catalog and the weapon label tables. It implements http.Handler:
// ServeHTTP serves the static files for non-API paths and the mux for the API routes.
type serverHandlers struct {
	root     *store.Root
	web      string
	jobs     *meshjobs.Runner
	weapKeys weapons.Catalog
	labelCat weapons.LabelCatalog
	mux      *http.ServeMux
	remote   *remoteJobs
	auth     *authSession
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
	raw = replayWithEnrichments(r.Context(), h.root, id, h.labelCat, raw)
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

// originAllowed says whether a state-changing request may come from r's Origin. A request
// with no Origin header (a same-origin or non-browser client) is allowed; a request whose
// Origin names a loopback host (localhost, 127.0.0.1, [::1], any port) is allowed. Any
// other Origin (another website open in the user's browser) is refused, so it cannot
// trigger a map build. Every state-changing route goes through this one helper.
func originAllowed(r *http.Request) bool {
	o := r.Header.Get("Origin")
	if o == "" {
		return true
	}
	u, err := url.Parse(o)
	if err != nil {
		return false
	}
	host := u.Hostname()
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

// handleMeshBuild answers POST /api/matches/{id}/mesh/build: it starts or joins the build
// for the match's module and answers 202 with the state JSON. A match whose mesh is already
// on disk answers 200 ready. A non-loopback Origin is refused with 403.
func (h serverHandlers) handleMeshBuild(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
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
		writeJSON(w, http.StatusConflict, map[string]string{"error": "no_map_module", "id": id})
		return
	}
	snap := h.jobs.Enqueue(meta.MapModule)
	status := http.StatusAccepted
	if snap.Ready() {
		status = http.StatusOK
	}
	writeJSON(w, status, meshStateJSON(snap))
}

// handleMeshState answers GET /api/matches/{id}/mesh/state with the module's build state.
func (h serverHandlers) handleMeshState(w http.ResponseWriter, r *http.Request) {
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
		writeJSON(w, http.StatusConflict, map[string]string{"error": "no_map_module", "id": id})
		return
	}
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	snap := h.jobs.Snapshot(meta.MapModule)
	writeJSON(w, http.StatusOK, meshStateJSON(snap))
}

// meshStateJSON is the state JSON the build and state routes hand out. Fields that do not
// apply for the state are omitted (an empty string, a zero, or an unset time).
func meshStateJSON(s meshjobs.Snapshot) map[string]any {
	out := map[string]any{"state": string(s.State), "moduleKey": s.ModuleKey}
	if s.Error != "" {
		out["error"] = s.Error
	}
	if s.QueuePosition > 0 {
		out["queuePosition"] = s.QueuePosition
	}
	if !s.StartedAt.IsZero() {
		out["startedAt"] = s.StartedAt.UTC().Format(time.RFC3339Nano)
		out["elapsedMs"] = s.ElapsedMs
	}
	if s.Bytes > 0 || s.Triangles > 0 {
		out["bytes"] = s.Bytes
		out["triangles"] = s.Triangles
	}
	return out
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
