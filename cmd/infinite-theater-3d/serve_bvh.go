package main

// serve_bvh.go — the ray/collision index sidecar (`three-mesh-bvh`, built and serialized by the
// client): GET .../mesh/bvh and .../variant/bvh answer it, PUT stores one.
//
// The index itself is opaque to the server: it only knows where to put the bytes (a path derived
// from the server's own map/variant key, never from client input) and whether they are still
// good. "Still good" is a cheap, file-system-only check, not a parse of the sidecar's own header:
// a sidecar is good only while its mtime is at or after the mtime of the GLB it was built from. A
// rebuild of that GLB always gives it a fresh (later) mtime, so an old sidecar reads as stale at
// once; the client's own header (format version, three-mesh-bvh version, build options, and
// per-geometry counts) catches everything else (a library upgrade, for one) and simply rebuilds
// and re-uploads when it does not match, which also refreshes the sidecar's mtime.

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// maxBVHSidecarBytes caps a stored ray-index sidecar; the geometry it indexes is itself capped by
// the map/variant build, so a legitimate sidecar never approaches this. A var, not a const, so a
// test can shrink it rather than building a real 256 MB body.
var maxBVHSidecarBytes int64 = 256 << 20 // 256 MB

// serveBVHSidecar answers a GET for the sidecar at sidecarPath, built from the file at sourcePath:
// a JSON 404 when the source itself does not exist (nothing to have indexed), when the sidecar is
// absent, or when the sidecar predates the source (stale: the source was rebuilt since).
func serveBVHSidecar(w http.ResponseWriter, r *http.Request, sourcePath, sidecarPath string) {
	srcInfo, err := os.Stat(sourcePath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "bvh_not_built"})
		return
	}
	bvhInfo, err := os.Stat(sidecarPath)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "bvh_not_built"})
		return
	}
	if bvhInfo.ModTime().Before(srcInfo.ModTime()) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "bvh_stale"})
		return
	}
	f, err := os.Open(sidecarPath)
	if err != nil {
		slog.Error("open bvh sidecar", "err", err, "path", sidecarPath)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	defer f.Close()
	serveRevalidated(w, r, filepath.Base(sidecarPath), f)
}

// storeBVHSidecar answers a PUT: writes the request body to sidecarPath atomically (capped,
// refused oversize), but only while sourcePath still exists — a sidecar for a build that is gone
// (or never was) has nothing to be stale against and is refused rather than written orphaned.
func storeBVHSidecar(w http.ResponseWriter, r *http.Request, root *store.Root, sourcePath, sidecarPath string) {
	if _, err := os.Stat(sourcePath); err != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "source_not_built"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBVHSidecarBytes)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "too_large"})
		return
	}
	if err := root.WriteFile(sidecarPath, data); err != nil {
		slog.Error("write bvh sidecar", "err", err, "path", sidecarPath)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "stored"})
}

// --- Map mesh -----------------------------------------------------------------------------------

// handleMeshBVH answers GET /api/matches/{id}/mesh/bvh: the map mesh's ray-index sidecar.
func (h serverHandlers) handleMeshBVH(w http.ResponseWriter, r *http.Request) {
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
	if meta.MapModule == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "bvh_not_built"})
		return
	}
	quality, ok := meshQualityFromRequest(w, r)
	if !ok {
		return
	}
	key := meshKeyOf(meta)
	meshPath, err := h.root.MeshPath(key, quality)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "bvh_not_built"})
		return
	}
	bvhPath, err := h.root.BVHPath(key, quality)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "bvh_not_built"})
		return
	}
	serveBVHSidecar(w, r, meshPath, bvhPath)
}

// handleMeshBVHPut answers PUT /api/matches/{id}/mesh/bvh: stores the map mesh's ray-index
// sidecar, built and serialized by the client.
func (h serverHandlers) handleMeshBVHPut(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
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
	if meta.MapModule == "" {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "no_map_module", "id": id})
		return
	}
	quality, ok := meshQualityFromRequest(w, r)
	if !ok {
		return
	}
	key := meshKeyOf(meta)
	meshPath, err := h.root.MeshPath(key, quality)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_module_key"})
		return
	}
	bvhPath, err := h.root.BVHPath(key, quality)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid_module_key"})
		return
	}
	storeBVHSidecar(w, r, h.root, meshPath, bvhPath)
}

// --- Match variant layer --------------------------------------------------------------------

// handleVariantBVH answers GET /api/matches/{id}/variant/bvh: the variant layer's ray-index
// sidecar.
func (h serverHandlers) handleVariantBVH(w http.ResponseWriter, r *http.Request) {
	id, ok := h.variantMatch(w, r)
	if !ok {
		return
	}
	quality, ok := meshQualityFromRequest(w, r)
	if !ok {
		return
	}
	variantGLB := variantPath(h.root, id, variantGLBName(quality))
	bvhPath := variantPath(h.root, id, variantBVHName(quality))
	serveBVHSidecar(w, r, variantGLB, bvhPath)
}

// handleVariantBVHPut answers PUT /api/matches/{id}/variant/bvh: stores the variant layer's
// ray-index sidecar.
func (h serverHandlers) handleVariantBVHPut(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	id, ok := h.variantMatch(w, r)
	if !ok {
		return
	}
	quality, ok := meshQualityFromRequest(w, r)
	if !ok {
		return
	}
	variantGLB := variantPath(h.root, id, variantGLBName(quality))
	bvhPath := variantPath(h.root, id, variantBVHName(quality))
	storeBVHSidecar(w, r, h.root, variantGLB, bvhPath)
}

// variantBVHName is a match variant layer's ray-index sidecar name for a texture quality,
// alongside variantGLBName's file: variant.bvh for standard, variant.high.bvh for high.
func variantBVHName(quality meshjobs.Quality) string {
	if quality == meshjobs.QualityHigh {
		return "variant.high.bvh"
	}
	return "variant.bvh"
}
