// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_firstperson.go — the first-person library routes: the index, the arm catalog, a
// library file (rig or shared texture), and the build/state pair. The first-person job
// shares the mesh build runner's queue with the map builds and the weapons job, so it never
// runs beside one; the Origin loopback check and the state JSON are the mesh routes' own.

import (
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/firstperson"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// firstPersonDir is the library folder inside the store's data directory.
func firstPersonDir(root *store.Root) string {
	return filepath.Join(root.Dir(), "first-person")
}

// handleFirstPersonIndex answers GET /api/first-person/index.json with the library's
// index.json. Before the library is built it is a JSON 404 naming first_person_not_built.
func (h serverHandlers) handleFirstPersonIndex(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(firstPersonDir(h.root), firstperson.FichierIndex)
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "first_person_not_built"})
		return
	}
	if err != nil {
		slog.Error("read first-person index", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}

// handleFirstPersonBras answers GET /api/first-person/bras.json with the arm pieces catalog.
func (h serverHandlers) handleFirstPersonBras(w http.ResponseWriter, r *http.Request) {
	path := filepath.Join(firstPersonDir(h.root), firstperson.FichierBras)
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "first_person_not_built"})
		return
	}
	if err != nil {
		slog.Error("read first-person arm catalog", "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(raw)
}

// resolveFirstPersonFile resolves name to the full path of one library file (a rig or a shared
// texture), saying whether it is one of the library's own file names that stays inside the
// library folder. The GET route and the bundle route both resolve a name through it.
func resolveFirstPersonFile(root *store.Root, name string) (string, bool) {
	if !firstperson.NomFichierPremierePersonne(name) || strings.ContainsAny(name, "/\\") {
		return "", false
	}
	return joinInside(firstPersonDir(root), name)
}

// handleFirstPersonFile answers GET /api/first-person/{file} with one library file (a rig or
// a shared texture, range-capable). The name must be one of the library's own file names and
// the resolved path must stay inside the library folder; a missing or foreign file is a JSON
// 404.
func (h serverHandlers) handleFirstPersonFile(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	full, ok := resolveFirstPersonFile(h.root, name)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "first_person_file_not_available", "file": name})
		return
	}
	info, err := os.Stat(full)
	if err != nil || info.IsDir() {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "first_person_file_not_available", "file": name})
		return
	}
	f, err := os.Open(full)
	if err != nil {
		if os.IsNotExist(err) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "first_person_file_not_available", "file": name})
			return
		}
		slog.Error("open first-person file", "err", err, "file", name)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer f.Close()
	http.ServeContent(w, r, name, time.Time{}, f)
}

// handleFirstPersonBuild answers POST /api/first-person/build: it starts or joins the
// first-person library build and answers 202 with the state JSON. A non-loopback Origin is
// refused with 403. With no match in the store the build opens the first installed map.
func (h serverHandlers) handleFirstPersonBuild(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	snap := h.jobs.Enqueue(meshjobs.JobFirstPerson)
	status := http.StatusAccepted
	if snap.Ready() {
		status = http.StatusOK
	}
	writeJSON(w, status, meshStateJSON(snap))
}

// handleFirstPersonState answers GET /api/first-person/state with the first-person library
// build state.
func (h serverHandlers) handleFirstPersonState(w http.ResponseWriter, r *http.Request) {
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, meshStateJSON(h.jobs.Snapshot(meshjobs.JobFirstPerson)))
}
