// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_backdrop.go — the home backdrop route.
//
// The ring backdrop build (the space scene with the Zeta Halo ring, decoded from the game
// install) is a background job: it is enqueued by the startup step (serve_startup.go) after
// the rank badge job, when the file is missing. As with the other asset routes, a request
// while it is not built yet answers 404 without enqueuing: the build is triggered by the
// startup.

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/backdrop"
)

// handleBackdropHome answers GET /api/backdrop/home with the built backdrop, a 404 when it
// is not built yet. The file is immutable once built (rebuilt only by the startup job), so
// it carries a long cache header.
func (h serverHandlers) handleBackdropHome(w http.ResponseWriter, r *http.Request) {
	full := filepath.Join(backdrop.OutDir(h.root.Dir()), backdrop.FileName)
	f, err := os.Open(full)
	if err != nil {
		if os.IsNotExist(err) {
			http.NotFound(w, r)
			return
		}
		slog.Error("open home backdrop", "err", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("Cache-Control", "public, max-age=604800")
	http.ServeContent(w, r, backdrop.FileName, time.Time{}, f)
}
