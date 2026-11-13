package main

// serve_weaponicons.go — the weapon-icon route and the startup enqueue.
//
// The icon build is a background job: when `serve` starts and a game install is found, it
// is enqueued in the mesh jobs runner right away if the icon set is missing. It is
// single-flight (the runner's queue), runs in the background, and never blocks startup.
// A request for an icon while the set is not built yet answers 404 without enqueuing
// anything: the build has a single trigger, the startup.

import (
	"log/slog"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// maybeEnqueueWeaponIcons starts the icon build at serve startup when the game install is
// found and the icon set is not built yet. It returns nothing and never blocks: the build
// runs in the runner's queue. An install that cannot be found is logged and skipped.
func maybeEnqueueWeaponIcons(jobs *meshjobs.Runner, dataDir, gameRoot string) {
	if jobs == nil {
		return
	}
	if !weaponicons.GameRootFound(gameRoot) {
		if gameRoot != "" {
			slog.Warn("game install not found, weapon icon build not started", "game", gameRoot, "env", himap.DeployRootEnv)
		}
		return
	}
	if weaponicons.SetReady(dataDir) {
		return
	}
	slog.Info("weapon icon set missing, starting background build")
	jobs.Enqueue(meshjobs.JobWeaponIcons)
}

// iconFile is a file name the icon route may serve: index.json, or one of the built styles
// with a two-digit index (contour-07.png, silhouette-40.png, killfeed-88.png). The built
// file is `<style>-NN.png`: after the style prefix, `NN.png` is six characters, and the
// bare `-NN` form (eight characters) is admitted so the name filter and the on-disk check
// stay one rule; a name that passes the filter but is not on disk still gets a 404.
func iconFile(name string) (style string, ok bool) {
	if name == "index.json" {
		return "json", true
	}
	for _, st := range []string{"contour", "silhouette", "killfeed"} {
		if !strings.HasPrefix(name, st+"-") {
			continue
		}
		rest := strings.TrimPrefix(name, st+"-")
		if len(rest) < 2 || rest[0] < '0' || rest[0] > '9' || rest[1] < '0' || rest[1] > '9' {
			continue
		}
		if len(rest) == 6 && rest[2:] == ".png" {
			return "png", true
		}
		if len(rest) == 8 {
			return "png", true
		}
	}
	return "", false
}

// handleWeaponIconFile answers GET /static/weapons-assets/halo_infinite/jeu/{file} with one
// file of the built icon set (a PNG or index.json). A file the build did not write, a name
// that is not a built file, or a name that would escape the set's folder is a 404. Nothing
// is enqueued here: the build's single trigger is the startup.
func (h serverHandlers) handleWeaponIconFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	style, ok := iconFile(name)
	if !ok {
		http.NotFound(w, r)
		return
	}
	full, ok := joinInside(weaponicons.OutDir(h.root.Dir()), name)
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
		slog.Error("open weapon icon", "err", err, "file", name)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	if style == "json" {
		w.Header().Set("Content-Type", "application/json")
	} else {
		w.Header().Set("Content-Type", "image/png")
	}
	http.ServeContent(w, r, name, time.Time{}, f)
}
