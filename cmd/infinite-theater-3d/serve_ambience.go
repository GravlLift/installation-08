package main

// serve_ambience.go — the per-match ambient bed route. The sound library job extracts every
// multiplayer map's main bed (internal/ambience) into the sound folder; this route answers a
// match with its map's bed, so the viewer never has to know the map module.

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/ambience"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// handleAmbience answers GET /api/matches/{id}/ambience.ogg with the match's map bed
// (range-capable via http.ServeContent). A match whose map has no extracted bed (library not
// built yet, or a map the game gives none) is a JSON 404 naming the module; nothing is enqueued.
func (h serverHandlers) handleAmbience(w http.ResponseWriter, r *http.Request) {
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
	notBuilt := map[string]string{"error": "ambience_not_built", "moduleKey": meta.MapModule}
	dir := soundsDir(h.root.Dir())
	m, err := ambience.ReadManifest(dir)
	if err != nil {
		writeJSON(w, http.StatusNotFound, notBuilt)
		return
	}
	name, ok := m.BedFile(meta.MapModule)
	if !ok {
		writeJSON(w, http.StatusNotFound, notBuilt)
		return
	}
	full, ok := joinInside(dir, name)
	if !ok {
		writeJSON(w, http.StatusNotFound, notBuilt)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Error("open ambience", "err", err, "file", name)
		}
		writeJSON(w, http.StatusNotFound, notBuilt)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", "audio/ogg")
	http.ServeContent(w, r, name, time.Time{}, f)
}
