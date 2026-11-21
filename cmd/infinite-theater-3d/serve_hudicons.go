// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_hudicons.go — the HUD icon route.
//
// The HUD icon build (the equipment and grenade glyphs the replay HUD and the weapon pads
// draw) is a background job: it is enqueued by the startup step (serve_startup.go) after
// the weapon-icon job, when the set is missing, and runs in the mesh jobs runner's queue.
// As with the weapon-icon route, a request while the set is not built yet answers 404
// without enqueuing anything: the build is triggered by the startup.

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// hudIconFile is a file name the HUD icon route may serve: index.json, or one of the
// built glyphs, a file name the HUD document references. The build writes one file per
// stem, the stem is the part before the .png.
func hudIconFile(name string) bool {
	if name == "index.json" || name == "pad-navpoint.json" {
		return true
	}
	for _, stem := range weaponicons.HudFileNames() {
		if name == stem+".png" {
			return true
		}
	}
	for _, font := range weaponicons.HudFontNames() {
		if name == font {
			return true
		}
	}
	return false
}

// handleHudIconFile answers GET /static/weapons-assets/halo_infinite/hud/{file} with one
// file of the built HUD set (a PNG or index.json). A file the build did not write, a name
// that is not a built file, or a name that would escape the set's folder is a 404. Nothing
// is enqueued here: the build is triggered by the startup.
func (h serverHandlers) handleHudIconFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if !hudIconFile(name) {
		http.NotFound(w, r)
		return
	}
	full, ok := joinInside(weaponicons.HudOutDir(h.root.Dir()), name)
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
		slog.Error("open hud icon", "err", err, "file", name)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	switch {
	case name == "index.json" || name == "pad-navpoint.json":
		w.Header().Set("Content-Type", "application/json")
	case strings.HasSuffix(name, ".ttf"):
		w.Header().Set("Content-Type", "font/ttf")
	default:
		w.Header().Set("Content-Type", "image/png")
	}
	http.ServeContent(w, r, name, time.Time{}, f)
}
