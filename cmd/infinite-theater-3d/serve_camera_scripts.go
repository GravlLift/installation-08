// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_camera_scripts.go — camera script storage: a camera script is a JSON document of
// camera keyframes for one match, kept at matches\<id>\camera-scripts\<name>.json. The web
// viewer saves and loads scripts through these routes (and so will local tools). The server
// does only a light shape check — a JSON object with version 1, a matchId equal to the
// route's id, and keys an array of at most 512 entries; the web client does the full
// validation when it loads a script.

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// maxCameraScriptBytes caps a stored camera script; a match of keyframes never approaches
// 256 KiB, so a larger body is a client bug or a probe, not a script.
var maxCameraScriptBytes int64 = 256 << 10 // 256 KiB

const maxCameraScriptKeys = 512

// cameraScriptMatchOK writes the standard answers for a camera script route — 400 for a bad
// id, 400 invalid_name for a bad name, 404 match_not_found for an unknown match — and says
// whether the request may proceed to the script itself.
func (h serverHandlers) cameraScriptMatchOK(w http.ResponseWriter, r *http.Request, needName bool) bool {
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid match id"})
		return false
	}
	if needName && !store.CameraScriptNameValid(r.PathValue("name")) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_name"})
		return false
	}
	if _, err := h.root.MatchMeta(id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found", "id": id})
			return false
		}
		slog.Error("match meta", "err", err, "id", id)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return false
	}
	return true
}

// handleCameraScriptList answers GET /api/matches/{id}/camera-scripts with
// {"scripts":[...]} — one entry per stored script (name, modified time in RFC3339 UTC, key
// count), sorted by name. An unknown match is a 404 match_not_found; a missing
// camera-scripts/ folder is an empty list; a file that does not parse as JSON is skipped
// (and logged), not an error.
func (h serverHandlers) handleCameraScriptList(w http.ResponseWriter, r *http.Request) {
	if !h.cameraScriptMatchOK(w, r, false) {
		return
	}
	id := r.PathValue("id")
	dir, err := h.root.MatchCameraScriptsDir(id)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid match id"})
		return
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusOK, map[string]any{"scripts": []any{}})
			return
		}
		slog.Error("camera scripts dir", "err", err, "id", id)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	scripts := []map[string]any{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			slog.Warn("camera script read", "err", err, "id", id, "name", e.Name())
			continue
		}
		var doc struct {
			Keys []json.RawMessage `json:"keys"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			slog.Warn("camera script parse", "err", err, "id", id, "name", e.Name())
			continue
		}
		modified := ""
		if info, err := e.Info(); err == nil {
			modified = info.ModTime().UTC().Format(time.RFC3339)
		}
		scripts = append(scripts, map[string]any{
			"name":     strings.TrimSuffix(e.Name(), ".json"),
			"modified": modified,
			"keys":     len(doc.Keys),
		})
	}
	sort.Slice(scripts, func(i, j int) bool {
		return scripts[i]["name"].(string) < scripts[j]["name"].(string)
	})
	writeJSON(w, http.StatusOK, map[string]any{"scripts": scripts})
}

// handleCameraScriptGet answers GET /api/matches/{id}/camera-scripts/{name} with the stored
// bytes of that script (Content-Type application/json): a 404 script_not_found when it is
// absent, a 404 match_not_found for an unknown match, 400 for a bad id or name.
func (h serverHandlers) handleCameraScriptGet(w http.ResponseWriter, r *http.Request) {
	if !h.cameraScriptMatchOK(w, r, true) {
		return
	}
	name := r.PathValue("name")
	path, err := h.root.MatchCameraScriptPath(r.PathValue("id"), name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_name"})
		return
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "script_not_found", "name": name})
			return
		}
		slog.Error("camera script read", "err", err, "name", name)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

// handleCameraScriptPut answers PUT /api/matches/{id}/camera-scripts/{name}: it stores the
// request body as the match's script after the light shape check — a JSON object with
// version equal to the number 1, matchId equal to the route's id, and keys an array of at
// most 512 entries. It sets the document's name to the route's name, then writes it
// atomically (WriteFile). A foreign Origin is a 403; a body over the cap is 413.
func (h serverHandlers) handleCameraScriptPut(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if !h.cameraScriptMatchOK(w, r, true) {
		return
	}
	id := r.PathValue("id")
	name := r.PathValue("name")
	r.Body = http.MaxBytesReader(w, r.Body, maxCameraScriptBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "script_too_large"})
		return
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(raw, &doc); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_script", "reason": "not a JSON object"})
		return
	}
	var version float64
	if err := json.Unmarshal(doc["version"], &version); err != nil || version != 1 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_script", "reason": "version must be 1"})
		return
	}
	var matchID string
	if err := json.Unmarshal(doc["matchId"], &matchID); err != nil || matchID != id {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_script", "reason": "matchId must match the route"})
		return
	}
	// A present-but-null keys is not an array (json.Unmarshal of null would succeed and
	// leave a nil slice), so the raw value itself must start with '['.
	keysRaw := bytes.TrimSpace(doc["keys"])
	if len(keysRaw) == 0 || keysRaw[0] != '[' {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_script", "reason": "keys must be an array"})
		return
	}
	var keys []json.RawMessage
	if err := json.Unmarshal(keysRaw, &keys); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_script", "reason": "keys must be an array"})
		return
	}
	if len(keys) > maxCameraScriptKeys {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_script", "reason": "too many keys"})
		return
	}
	nameJSON, _ := json.Marshal(name)
	doc["name"] = nameJSON
	final, err := json.Marshal(doc)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	path, err := h.root.MatchCameraScriptPath(id, name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_name"})
		return
	}
	if err := h.root.WriteFile(path, final); err != nil {
		slog.Error("camera script write", "err", err, "id", id, "name", name)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "keys": len(keys)})
}

// handleCameraScriptDelete answers DELETE /api/matches/{id}/camera-scripts/{name}: it
// removes the one file matches\<id>\camera-scripts\<name>.json and answers 204; a script
// that is absent is a 404 script_not_found. A foreign Origin is a 403.
func (h serverHandlers) handleCameraScriptDelete(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if !h.cameraScriptMatchOK(w, r, true) {
		return
	}
	name := r.PathValue("name")
	path, err := h.root.MatchCameraScriptPath(r.PathValue("id"), name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_name"})
		return
	}
	if err := os.Remove(path); err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "script_not_found", "name": name})
			return
		}
		slog.Error("camera script remove", "err", err, "name", name)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
