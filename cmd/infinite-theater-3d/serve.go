// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

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
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// Version is the build version, reported by the version command and /api/health. The
// packaging build sets it with -ldflags "-X main.Version=<version>"; a build without
// the flag reports the development version.
var Version = "0.1.0-dev"

// serveFlags is the parsed form of the `serve` arguments.
type serveFlags struct {
	addr     string
	addrSet  bool // --addr was given: never replaced by a fallback port
	web      string
	open     bool
	ui       string // --ui: window (the app's own window) or browser (the default browser)
	readOnly bool
	dataDir  string
	game     string
	mapKey   string
}

// parseServeFlags turns `serve` arguments into serveFlags.
func parseServeFlags(args []string) (serveFlags, error) {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	var f serveFlags
	fs.StringVar(&f.addr, "addr", "127.0.0.1:8177", "listen address (loopback by default)")
	fs.StringVar(&f.web, "web", "", "directory of static files to serve for non-API paths (optional; the embedded viewer answers when no directory is given)")
	fs.BoolVar(&f.open, "open", false, "open the UI on the server's address once it is listening")
	fs.StringVar(&f.ui, "ui", defaultUI(), "UI to open with --open: window (the app's own window) or browser (the default browser)")
	fs.BoolVar(&f.readOnly, "read-only", false, "refuse every state-changing request (for a server shown to others through a tunnel)")
	fs.StringVar(&f.dataDir, "data", "", dataDirHelp)
	fs.StringVar(&f.game, "game", "", "game deploy root for map and weapon builds (empty auto-detects)")
	fs.StringVar(&f.mapKey, "map", "", "installed map whose module index weapon builds open (default: first map in the data store)")
	err := fs.Parse(args)
	if err != nil {
		return f, err
	}
	if f.ui != uiWindow && f.ui != uiBrowser {
		return f, fmt.Errorf("unknown --ui value %q (window or browser)", f.ui)
	}
	fs.Visit(func(fl *flag.Flag) {
		if fl.Name == "addr" {
			f.addrSet = true
		}
	})
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
	// The app window's File menu opens the data dir this serve uses.
	appWindowDataDir = dataDir
	// Launch order (serve_launch.go): claim the data folder, then an address, and only then
	// touch the data. A launch that cannot claim either exits before writing anything.
	claim, err := claimDataDir(dataDir)
	if errors.Is(err, errDataDirBusy) {
		return onDataDirBusy(dataDir, f.open, f.ui)
	}
	if err != nil {
		return err
	}
	defer claim.release()
	ln, err := listenServe(f)
	if err != nil {
		return err
	}
	defer ln.Close()
	addr := ln.Addr().String()
	claim.recordAddr(addr)
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
	labelCat, err := weapons.LoadLabelCatalog()
	if err != nil {
		return err
	}
	h := newServerHandlers(root, f.web, jobs, weaponKeys, labelCat)
	h.readOnly = f.readOnly
	// The job is shared by pointer, so the routes the mux already bound see the game root.
	h.coatingsSetup.game = f.game
	h.callouts.game = f.game
	h.callouts.cache.Persist = !f.readOnly
	// The startup starts the coatings setup through the same job the POST route uses, so a
	// run is single-flight whichever way it is started.
	runServeStartup(h.jobs, func(module string) bool { return jobModuleReady(root, module) }, root, f.game, func() { h.startCoatingsSetup() })
	// The startup update check runs once in the background (15 s after startup); a
	// -dev build skips it inside.
	startUpdateCheck()
	if f.readOnly {
		slog.Info("read-only mode: state-changing requests are refused")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// A pending device-code login dies with the server (its wait fires, the session ends
	// failed; no goroutine is left polling Microsoft).
	defer h.stopPendingLogin()
	srv := &http.Server{
		Handler:           h.readOnlyHandler(),
		ReadHeaderTimeout: 5 * time.Second,
	}
	if f.open && f.ui == uiWindow {
		// The app window runs on the main OS thread; the server runs in a goroutine.
		// Closing the window cancels the context, the same path Ctrl+C takes. When the
		// window cannot be created, openWindowUI falls back to the default browser and the
		// process stays running on the signal path, exactly as the browser mode does.
		coreErr := make(chan error, 1)
		go func() { coreErr <- serveCore(ctx, srv, ln, addr, dataDir) }()
		closed := openWindowUI(f.ui, addr)
		if closed {
			stop()
		}
		return <-coreErr
	}
	if f.open {
		fmt.Printf("\n%s is running at %s\nKeep this window open while you use the viewer. Close it to stop.\n\n", appDisplayName, urlForAddr(addr))
		openOnListen(ctx, addr)
	}
	return serveCore(ctx, srv, ln, addr, dataDir)
}

// serveCore serves the server and blocks until a cancellation signal or a serve failure,
// then shuts it down cleanly.
func serveCore(ctx context.Context, srv *http.Server, ln net.Listener, addr, dataDir string) error {
	slog.Info("Installation 08 serving", "addr", addr, "data", dataDir)
	errCh := make(chan error, 1)
	go func() {
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

// serverHandlers bundles the store, the static source, the mesh build runner, the weapon
// model catalog and the weapon label tables. It implements http.Handler: ServeHTTP serves
// the static files for non-API paths and the mux for the API routes.
type serverHandlers struct {
	root      *store.Root
	web       string // the --web directory, when given
	webFS     fs.FS  // the embedded viewer, nil when the build has none
	readOnly  bool   // when true, the server refuses every state-changing request
	jobs      *meshjobs.Runner
	weapKeys  weapons.Catalog
	labelCat  weapons.LabelCatalog
	mux       *http.ServeMux
	remote    *remoteJobs
	auth      *authSession
	listCache *matchlistCache
	// coatingsSetup is the in-app coatings setup job (serve_coatings_setup.go).
	coatingsSetup *coatingsSetupJob
	// callouts reads and caches the maps' named areas (serve_callouts.go).
	callouts *calloutsSource
}

// readOnlyHandler is the one middleware the read-only mode wraps the top-level handler in:
// it refuses every request whose method is not GET, HEAD or OPTIONS with a 403 before any
// route (static or API) runs. The GET routes it passes through are served from a fresh mux
// bound to this handler (readOnly set), so the auth and remote routes answer their
// signed-out shapes; the server's original mux was built before readOnly was known. When
// the server is not read-only it passes the request through unchanged.
func (h serverHandlers) readOnlyHandler() http.Handler {
	if !h.readOnly {
		return h
	}
	inner := h
	inner.mux = inner.buildMux()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// The bundle only reads library files (it changes no state), so it is allowed in read-only
		// the way the library's own GET routes are; without it the batched viewer loads would fail.
		if r.Method == http.MethodPost && r.URL.Path == "/api/bundle" {
			inner.ServeHTTP(w, r)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "read_only"})
			return
		}
		inner.ServeHTTP(w, r)
	})
}

// ServeHTTP routes a request: the built-in context assets for the medals and map
// previews, the static viewer (the --web directory or the embedded one) for the paths
// it serves, and the API mux otherwise.
func (h serverHandlers) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/static/medals/") || strings.HasPrefix(r.URL.Path, "/static/maps/") {
		h.serveContextAsset(w, r)
		return
	}
	if h.servesStatic(r) {
		if h.web != "" {
			h.serveStaticDir(w, r)
			return
		}
		h.serveEmbedded(w, r)
		return
	}
	h.mux.ServeHTTP(w, r)
}

// servesStatic says whether the path is one the static viewer answers: any path outside
// the two prefixes the server keeps for itself, /api/ (the API) and /static/ (the icon,
// rank, sound and context-asset routes of the mux).
func (h serverHandlers) servesStatic(r *http.Request) bool {
	if h.web == "" && h.webFS == nil {
		return false
	}
	return !strings.HasPrefix(r.URL.Path, "/api/") && !strings.HasPrefix(r.URL.Path, "/static/")
}

// serveEmbedded serves the embedded viewer: the named file when the tree holds it,
// otherwise index.html (the single-page-app convention, so a client route such as
// /match/<id> opens the viewer).
func (h serverHandlers) serveEmbedded(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if info, err := fs.Stat(h.webFS, name); name != "" && err == nil && !info.IsDir() {
		w.Header().Set("Cache-Control", embeddedCacheControl(name))
		http.ServeFileFS(w, r, h.webFS, name)
		return
	}
	index, err := fs.ReadFile(h.webFS, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", embeddedCacheControl("index.html"))
	http.ServeContent(w, r, "index.html", time.Time{}, bytes.NewReader(index))
}

// embeddedCacheControl says how long the app window may keep an embedded viewer file.
// Embedded files carry no modification time, so without this header WebView2 guessed and kept
// the previous release's index.html after an update, which pointed at the old bundle (test.19
// showed test.18's home screen until a reload). Vite's assets/ files carry a content hash in
// their names, so they never change under one name and can be kept for good; everything else
// (index.html, the icons, the wordmark) is fetched again on every load, which costs nothing
// over loopback.
func embeddedCacheControl(name string) string {
	if strings.HasPrefix(name, "assets/") {
		return "public, max-age=31536000, immutable"
	}
	return "no-cache"
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
	viewer := "false"
	if h.web != "" || h.webFS != nil {
		viewer = "true"
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true", "version": Version, "viewer": viewer})
}

// handleMatches answers /api/matches with the match summaries, newest first, enriched with
// the list fields (mode, playlist, outcome, score, start time, map image) from the stored
// context data. A match whose context data is missing keeps its stored fields and omits the
// new ones; the list never fails over a single match.
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
	rows := matchlistEnriched(h.root, ms, h.matchlistAccountName(), h.listCache)
	markMapsReady(rows, func(module string) bool { return jobModuleReady(h.root, module) },
		func(id string) bool { return hasMatchMvar(h.root, id) })
	writeJSON(w, http.StatusOK, rows)
}

// matchlistAccountName is the signed-in account's gamertag ("" when none is known): the
// session's in-memory value when a login completed in this process, else the stored
// credentials (the same code path the auth state route uses). The roster match is on the
// name, not the xuid: the stored summary may predate a sign-in that has no gamertag here,
// and the name is what the web already matches on.
func (h serverHandlers) matchlistAccountName() string {
	if h.auth == nil {
		return ""
	}
	s := h.auth
	s.mu.Lock()
	gamer := s.gamer
	s.mu.Unlock()
	if gamer != "" {
		return gamer
	}
	if st := storedAuthState(h.root.Dir()); st["gamertag"] != nil {
		if tag, ok := st["gamertag"].(string); ok {
			return tag
		}
	}
	return ""
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
// for the match's world mesh (meshKeyOf) and answers 202 with the state JSON. A match whose
// mesh is already on disk answers 200 ready. A non-loopback Origin is refused with 403.
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
	quality, ok := meshQualityFromRequest(w, r)
	if !ok {
		return
	}
	// The viewer is waiting on this map: it goes ahead of the background builds.
	snap := h.jobs.EnqueueFirst(meshjobs.JobKey(meshKeyOf(meta), quality))
	status := http.StatusAccepted
	if snap.Ready() {
		status = http.StatusOK
	}
	writeJSON(w, status, meshStateJSON(snap))
}

// handleMeshCancel cancels the running build of the match's world mesh (meshKeyOf).
func (h serverHandlers) handleMeshCancel(w http.ResponseWriter, r *http.Request) {
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
		} else {
			slog.Error("match meta", "err", err, "id", id)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		}
		return
	}
	if meta.MapModule == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "no_map_module", "id": id})
		return
	}
	quality, ok := meshQualityFromRequest(w, r)
	if !ok {
		return
	}
	key := meshjobs.JobKey(meshKeyOf(meta), quality)
	if !h.jobs.Cancel(key) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "build_not_running"})
		return
	}
	writeJSON(w, http.StatusOK, meshStateJSON(h.jobs.Snapshot(key)))
}

// handleMeshState answers GET /api/matches/{id}/mesh/state with the build state of the match's world mesh.
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
	quality, ok := meshQualityFromRequest(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, meshStateJSON(h.jobs.Snapshot(meshjobs.JobKey(meshKeyOf(meta), quality))))
}

// meshQualityFromRequest reads the ?quality= query parameter of a mesh or variant route:
// absent or standard is the default (today's behavior), high names the high-quality build,
// any other value is a 400. ok false (the answer already written) on a refused value.
func meshQualityFromRequest(w http.ResponseWriter, r *http.Request) (meshjobs.Quality, bool) {
	s := r.URL.Query().Get("quality")
	q, ok := meshjobs.ParseQuality(s)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown_quality", "quality": s})
		return "", false
	}
	return q, true
}

// meshStateJSON is the state JSON the build and state routes hand out. Fields that do not
// apply for the state are omitted (an empty string, a zero, or an unset time); quality is
// present only for a high-quality build (standard is the unnamed default).
func meshStateJSON(s meshjobs.Snapshot) map[string]any {
	out := map[string]any{"state": string(s.State), "moduleKey": s.ModuleKey}
	if _, quality := meshjobs.SplitQuality(s.ModuleKey); quality == meshjobs.QualityHigh {
		out["quality"] = string(quality)
	}
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
	if s.Progress > 0 {
		out["progress"] = s.Progress
	}
	if s.Stage != "" {
		out["stage"] = s.Stage
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
	quality, ok := meshQualityFromRequest(w, r)
	if !ok {
		return
	}
	key := meshjobs.JobKey(meshKeyOf(meta), quality)
	path, err := h.root.MeshPath(meshKeyOf(meta), quality)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "mesh_not_built", "moduleKey": key})
		return
	}
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "mesh_not_built", "moduleKey": key})
			return
		}
		slog.Error("open mesh", "err", err, "module", key)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer file.Close()
	serveRevalidated(w, r, "mesh.glb", file)
}

// serveRevalidated serves a built model file (a map mesh, a Forge variant) so the browser keeps
// it in its cache and asks again on every load: a 304 when the file is the one it holds, the
// whole file after a rebuild. The validators are the file's size and modification time, which a
// rebuild always changes. Without them every load re-downloaded hundreds of MB.
func serveRevalidated(w http.ResponseWriter, r *http.Request, name string, f *os.File) {
	var mod time.Time
	if st, err := f.Stat(); err == nil {
		mod = st.ModTime()
		w.Header().Set("ETag", fmt.Sprintf(`"%x-%x"`, st.Size(), mod.UnixNano()))
	}
	w.Header().Set("Cache-Control", "no-cache")
	http.ServeContent(w, r, name, mod, f)
}

// serveStaticDir serves a file from the web directory, falling back to index.html for a
// path with no file (the single-page-app convention). A request that would escape the web
// directory (a .. segment) is refused.
func (h serverHandlers) serveStaticDir(w http.ResponseWriter, r *http.Request) {
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
