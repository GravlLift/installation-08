package main

// serve_weapons.go — the weapon-library routes: the index, a model file, and the build/state
// pair. The weapons job shares the mesh build runner's queue with the map builds, so it never
// runs beside one; the Origin loopback check and the state JSON are the mesh routes' own.

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// weaponCatalogFor resolves the weapon catalog the server builds: the --map flag when given,
// otherwise the first map module in the store (any installed map's index covers the game's
// weapons). It is resolved once at startup, off the game disk.
func weaponCatalogFor(root *store.Root, mapKey string) weapons.Catalog {
	if mapKey == "" {
		if ms, err := root.ListMatches(); err == nil && len(ms) > 0 && ms[0].MapModule != "" {
			mapKey = ms[0].MapModule
		}
	}
	return weapons.Catalog{Map: mapKey}
}

// handleWeaponIndex answers GET /api/weapons with the weapon library's index.json. Before the
// library is built it is a JSON 404 naming weapons_not_built.
func (h serverHandlers) handleWeaponIndex(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(h.root.Dir(), "weapons", "index.json")
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "weapons_not_built"})
		return
	}
	if err != nil {
		slog.Error("read weapon index", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}

// handleWeaponModel answers GET /api/weapons/{file} with one library file: a model GLB
// (range-capable), a coating file (coatings.json, coating-<style>.json, swatch-<gradient>.png,
// the spartanpieces contract beside the Spartan piece routes) or a team banner image
// (banner-<key>-cloth.png, banner-<key>-emblem<rank>.png). A missing file is a JSON 404.
func (h serverHandlers) handleWeaponModel(w http.ResponseWriter, r *http.Request) {
	file := r.PathValue("file")
	dir := filepath.Join(h.root.Dir(), "weapons")
	if weapons.CoatingFile(file) || weapons.BannerFile(file) {
		h.serveWeaponFile(w, r, dir, file, map[string]string{"error": "coating_not_available", "file": file})
		return
	}
	key := strings.TrimSuffix(file, ".glb")
	if !strings.HasSuffix(file, ".glb") || !weapons.ModelKeyValid(key) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "weapon_model_not_available", "key": key})
		return
	}
	h.serveWeaponFile(w, r, dir, weapons.FileOf(key), map[string]string{"error": "weapon_model_not_available", "key": key})
}

// serveWeaponFile serves one library file of dir (range-capable); a missing file, a directory,
// or a path that escapes the folder is the JSON 404 notFound.
func (h serverHandlers) serveWeaponFile(w http.ResponseWriter, r *http.Request, dir, file string, notFound map[string]string) {
	full, ok := joinInside(dir, file)
	if !ok {
		writeJSON(w, http.StatusNotFound, notFound)
		return
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		writeJSON(w, http.StatusNotFound, notFound)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, notFound)
			return
		}
		slog.Error("open weapon library file", "err", err, "file", file)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", spartanpieces.FileType(file))
	http.ServeContent(w, r, file, time.Time{}, f)
}

// handleWeaponBuild answers POST /api/weapons/build: it starts or joins the weapon library
// build and answers 202 with the state JSON. A non-loopback Origin is refused with 403. A build
// is refused when the catalog has no map key (no map in the store and no --map flag).
func (h serverHandlers) handleWeaponBuild(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if h.weapKeys.Map == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "no_map_module"})
		return
	}
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	snap := h.jobs.Enqueue(meshjobs.JobWeapons)
	status := http.StatusAccepted
	if snap.Ready() {
		status = http.StatusOK
	}
	writeJSON(w, status, meshStateJSON(snap))
}

// handleWeaponState answers GET /api/weapons/state with the weapon library build state.
func (h serverHandlers) handleWeaponState(w http.ResponseWriter, r *http.Request) {
	if h.weapKeys.Map == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "no_map_module"})
		return
	}
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, meshStateJSON(h.jobs.Snapshot(meshjobs.JobWeapons)))
}
