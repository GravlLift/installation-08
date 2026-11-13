package main

// serve_ranks.go — the rank badge route.
//
// The rank badge build (the 31 CSR tier badges decoded from the game install's bitm
// atlas) is a background job: it is enqueued by the startup step (serve_startup.go)
// after the HUD icon job, when the set is missing, and runs in the mesh jobs runner's
// queue. As with the other icon routes, a request while the set is not built yet
// answers 404 without enqueuing anything: the build is triggered by the startup.

import (
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/rankicons"
)

// rankIconFile is a file name the rank badge route may serve: one of the badge PNGs
// the build writes, under the exact name the match context emits.
func rankIconFile(name string) bool {
	return rankicons.FileValid(name)
}

// handleRankIconFile answers GET /static/ranks/halo_infinite/{file} with one badge of
// the built set. A badge the build did not write, a name that is not a badge file, or a
// name that would escape the set's folder is a 404. Nothing is enqueued here: the build
// is triggered by the startup.
func (h serverHandlers) handleRankIconFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if !rankIconFile(name) {
		http.NotFound(w, r)
		return
	}
	full, ok := joinInside(rankicons.OutDir(h.root.Dir()), name)
	if !ok {
		http.NotFound(w, r)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		if os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		}
		slog.Error("open rank badge", "err", err, "file", name)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "image/png")
	http.ServeContent(w, r, name, time.Time{}, f)
}
