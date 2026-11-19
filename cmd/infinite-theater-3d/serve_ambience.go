// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_ambience.go — the per-match ambient bed routes. The sound library job extracts every
// multiplayer map's ambient beds (internal/ambience) into the sound folder; these routes answer
// a match with its map's bed(s), so the viewer never has to know the map module.

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/ambience"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// ambienceLayout answers GET /api/matches/{id}/ambience.json with the match's map layout:
// {"fallback", "files", "gains", "zones", "reverbs", "fallbackReverb"}. A match whose map has no extracted bed (library not built yet,
// or a map the game gives none) is a JSON 404 naming the module; nothing is enqueued.
func (h serverHandlers) ambienceLayout(w http.ResponseWriter, r *http.Request) {
	m, module, ok := h.ambienceLookup(w, r)
	if !ok {
		return
	}
	lay, ok := m.Layout(module)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ambience_not_built", "moduleKey": module})
		return
	}
	reverbs := lay.Reverbs
	if reverbs == nil {
		reverbs = map[string]ambience.Reverb{}
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"fallback": lay.Fallback, "files": lay.Files, "gains": lay.Gains, "zones": lay.Zones,
		"reverbs": reverbs, "fallbackReverb": lay.FallbackReverb,
	})
}

// ambienceTake answers GET /api/matches/{id}/ambience/{file} with one take file or one zone
// reverb's impulse response (range-capable via http.ServeContent), only when that file is listed
// in the match's map layout; otherwise a JSON 404 ambience_not_built.
func (h serverHandlers) ambienceTake(w http.ResponseWriter, r *http.Request) {
	m, module, ok := h.ambienceLookup(w, r)
	if !ok {
		return
	}
	lay, ok := m.Layout(module)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ambience_not_built", "moduleKey": module})
		return
	}
	file := r.PathValue("file")
	notBuilt := map[string]string{"error": "ambience_not_built", "moduleKey": module}
	listed, contentType := false, "audio/ogg"
	for _, name := range lay.Files {
		if name == file {
			listed = true
			break
		}
	}
	for _, rv := range lay.Reverbs {
		if rv.File == file {
			listed, contentType = true, "audio/wav"
			break
		}
	}
	if !listed {
		writeJSON(w, http.StatusNotFound, notBuilt)
		return
	}
	dir := soundsDir(h.root.Dir())
	full, ok := joinInside(dir, file)
	if !ok {
		writeJSON(w, http.StatusNotFound, notBuilt)
		return
	}
	f, err := os.Open(full)
	if err != nil {
		if !os.IsNotExist(err) {
			slog.Error("open ambience take", "err", err, "file", file)
		}
		writeJSON(w, http.StatusNotFound, notBuilt)
		return
	}
	defer f.Close()
	w.Header().Set("Content-Type", contentType)
	http.ServeContent(w, r, file, time.Time{}, f)
}

// handleAmbience answers GET /api/matches/{id}/ambience.ogg with the match's map bed
// (range-capable via http.ServeContent). A match whose map has no extracted bed (library not
// built yet, or a map the game gives none) is a JSON 404 naming the module; nothing is enqueued.
func (h serverHandlers) handleAmbience(w http.ResponseWriter, r *http.Request) {
	m, module, ok := h.ambienceLookup(w, r)
	if !ok {
		return
	}
	notBuilt := map[string]string{"error": "ambience_not_built", "moduleKey": module}
	name, ok := m.BedFile(module)
	if !ok {
		writeJSON(w, http.StatusNotFound, notBuilt)
		return
	}
	dir := soundsDir(h.root.Dir())
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

// ambienceLookup factors the match->manifest lookup shared by the ambience routes: it writes the
// matching 400/404/500 response and returns false when there is nothing to serve. It returns
// the manifest and the match's map module key.
func (h serverHandlers) ambienceLookup(w http.ResponseWriter, r *http.Request) (*ambience.Manifest, string, bool) {
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid match id"})
		return nil, "", false
	}
	meta, err := h.root.MatchMeta(id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found", "id": id})
			return nil, "", false
		}
		slog.Error("match meta", "err", err, "id", id)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return nil, "", false
	}
	dir := soundsDir(h.root.Dir())
	m, err := ambience.ReadManifest(dir)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "ambience_not_built", "moduleKey": meta.MapModule})
		return nil, "", false
	}
	return m, meta.MapModule, true
}
