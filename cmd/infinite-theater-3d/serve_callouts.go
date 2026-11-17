// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_callouts.go — GET /api/matches/{id}/callouts: the named areas of the match's map (the
// place name the game's HUD shows under the motion tracker), read at runtime from the
// installed game (internal/callouts) and cached. A native map's areas come from its level tag,
// a Forge map's from the match's own map variant. Nothing is enqueued: the read takes about a
// second, once per map and process.

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/callouts"
	"github.com/llampwall/infinite-theater-3d/internal/ekursetup"
	"github.com/llampwall/infinite-theater-3d/internal/meshbuild"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// calloutsSource holds the route's cache and the --game folder it reads (shared by pointer, so
// the routes the mux already bound see the flag once serve sets it).
type calloutsSource struct {
	game  string
	cache *callouts.Cache
}

// newCalloutsSource builds the source for a data directory; the disk cache lives under
// <data>/assets/callouts.
func newCalloutsSource(dataDir string) *calloutsSource {
	s := &calloutsSource{}
	s.cache = &callouts.Cache{
		Dir:      filepath.Join(dataDir, "assets", "callouts"),
		Persist:  true,
		GameRoot: func() (string, error) { return ekursetup.ResolveGameRoot(s.game) },
	}
	return s
}

// handleCallouts answers {"version", "source", "zones": [{en, fr, polygon, zBottom, zTop}]}.
// A map without named areas is a 200 with no zones; a match whose map cannot be read (no game
// installed, module absent) is a JSON 404 naming the reason.
func (h serverHandlers) handleCallouts(w http.ResponseWriter, r *http.Request) {
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
	if h.callouts == nil || !store.ModuleKeyValid(meta.MapModule) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "callouts_unavailable", "moduleKey": meta.MapModule})
		return
	}
	var set callouts.Set
	if meshbuild.IsForgeCanvas(meta.MapModule) {
		raw, rerr := os.ReadFile(variantPath(h.root, id, "map.mvar"))
		if rerr != nil {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "callouts_unavailable", "reason": "no_map_variant"})
			return
		}
		set, err = h.callouts.cache.Forge(id, raw)
	} else {
		set, err = h.callouts.cache.Native(meta.MapModule)
	}
	switch {
	case errors.Is(err, ekursetup.ErrNoGame):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "callouts_unavailable", "reason": "no_game"})
		return
	case errors.Is(err, callouts.ErrNoModule):
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "callouts_unavailable", "reason": "module_absent", "moduleKey": meta.MapModule})
		return
	case err != nil:
		slog.Warn("callouts", "err", err, "id", id, "module", meta.MapModule)
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "callouts_unavailable", "reason": "read_error"})
		return
	}
	writeJSON(w, http.StatusOK, set)
}
