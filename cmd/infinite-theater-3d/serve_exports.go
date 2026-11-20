// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_exports.go — exported clip storage: a clip is an mp4 the web viewer rendered from a
// camera script, kept at matches\<id>\exports\<name>.mp4. The viewer uploads a finished clip
// through PUT (the request body is the mp4 itself, streamed straight to disk); a following
// GET serves the stored file back, so a clip lands on disk with no browser download click.

import (
	"bufio"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
)

// maxExportBytes caps a stored clip; a rendered clip can be hundreds of MB, so the cap is
// 2 GiB, well above any real clip — a larger body is a client bug or a probe, not a clip.
var maxExportBytes int64 = 2 << 30 // 2 GiB

// handleExportPut answers PUT /api/matches/{id}/exports/{name}: the request body is the
// rendered mp4 itself. A foreign Origin is a 403; a Content-Type that is not video/mp4 is
// a 415; a body over the cap is a 413 with no file left behind; an empty body is a 400
// with no file. On success the bytes are streamed to disk (WriteStream) and the answer is
// {"name":..., "path":<absolute file path>, "bytes":<n>}.
func (h serverHandlers) handleExportPut(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if !h.cameraScriptMatchOK(w, r, true) {
		return
	}
	if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "video/mp4") {
		writeJSON(w, http.StatusUnsupportedMediaType, map[string]string{"error": "unsupported_media_type"})
		return
	}
	id := r.PathValue("id")
	name := r.PathValue("name")
	r.Body = http.MaxBytesReader(w, r.Body, maxExportBytes)
	body := bufio.NewReader(r.Body)
	// An empty body is refused before anything touches the disk: writing it would rename an
	// empty temp over the destination and destroy a clip already stored under the name.
	if _, err := body.Peek(1); err == io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "empty_body"})
		return
	}
	path, err := h.root.MatchExportPath(id, name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_name"})
		return
	}
	n, err := h.root.WriteStream(path, body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "export_too_large"})
			return
		}
		slog.Error("export write", "err", err, "id", id, "name", name)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "path": path, "bytes": n})
}

// handleExportGet answers GET /api/matches/{id}/exports/{name} with the stored clip
// (Content-Type video/mp4) via http.ServeFile: a 404 export_not_found when it is absent,
// a 404 match_not_found for an unknown match, 400 for a bad id or name.
func (h serverHandlers) handleExportGet(w http.ResponseWriter, r *http.Request) {
	if !h.cameraScriptMatchOK(w, r, true) {
		return
	}
	id := r.PathValue("id")
	name := r.PathValue("name")
	path, err := h.root.MatchExportPath(id, name)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_name"})
		return
	}
	if _, err := os.Stat(path); err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "export_not_found", "name": name})
			return
		}
		slog.Error("export stat", "err", err, "id", id, "name", name)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "video/mp4")
	http.ServeFile(w, r, path)
}
