// serve_spartanpieces.go — the Spartan armor piece library routes: a library
// file (index, piece or attachment GLB, shared texture, coating table, coating
// file or swatch), and the build/state pair. The spartan-pieces job shares the
// mesh build runner's queue with the map builds, the weapons and the
// first-person jobs, so it never runs beside one; the Origin loopback check
// and the state JSON are the mesh routes' own.
package main

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// spartanPiecesDir is the library folder inside the store's data directory.
func spartanPiecesDir(root *store.Root) string {
	return filepath.Join(root.Dir(), "spartan-pieces")
}

// resolveSpartanPiecesFile resolves name to the full path of one library file, saying whether
// it is one of the library's own file names (LevelUp's whitelist) that stays inside the library
// folder. The GET route and the bundle route both resolve a name through it.
func resolveSpartanPiecesFile(root *store.Root, name string) (string, bool) {
	if !spartanpieces.LibraryFile(name) || strings.ContainsAny(name, "/\\") {
		return "", false
	}
	return joinInside(spartanPiecesDir(root), name)
}

// handleSpartanPiecesFile answers GET /api/spartan-pieces/{file} with one
// library file (range-capable). The name must be one of the library's own file
// names (LevelUp's whitelist) and the resolved path must stay inside the
// library folder; a missing or foreign file is a JSON 404.
func (h serverHandlers) handleSpartanPiecesFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	full, ok := resolveSpartanPiecesFile(h.root, name)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "spartan_pieces_file_not_available", "file": name})
		return
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "spartan_pieces_file_not_available", "file": name})
		return
	}
	f, err := os.Open(full)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "spartan_pieces_file_not_available", "file": name})
			return
		}
		slog.Error("open spartan piece library file", "err", err, "file", name)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", spartanpieces.FileType(name))
	http.ServeContent(w, r, name, time.Time{}, f)
}

// handleSpartanPiecesBuild answers POST /api/spartan-pieces/build: it starts
// or joins the Spartan piece library build and answers 202 with the state
// JSON. A non-loopback Origin is refused with 403. With no match in the store
// the build opens the first installed map.
func (h serverHandlers) handleSpartanPiecesBuild(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	snap := h.jobs.Enqueue(meshjobs.JobSpartanPieces)
	status := http.StatusAccepted
	if snap.Ready() {
		status = http.StatusOK
	}
	writeJSON(w, status, meshStateJSON(snap))
}

// handleSpartanPiecesState answers GET /api/spartan-pieces/state with the
// Spartan piece library build state.
func (h serverHandlers) handleSpartanPiecesState(w http.ResponseWriter, r *http.Request) {
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, meshStateJSON(h.jobs.Snapshot(meshjobs.JobSpartanPieces)))
}
