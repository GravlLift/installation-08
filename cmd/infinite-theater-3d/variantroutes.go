package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/meshbuild"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

const variantPrefix = "variant:"

func variantJobID(key string) (string, bool) {
	id, ok := strings.CutPrefix(key, variantPrefix)
	return id, ok && store.MatchIDValid(id)
}

// variantJobKey is a match variant's build key for a texture quality: variant:<id> for standard,
// variant:<id>.high for high (a separate job from standard).
func variantJobKey(id string, quality meshjobs.Quality) string {
	return variantPrefix + meshjobs.JobKey(id, quality)
}

// variantGLBName is a match variant's layer file for a texture quality: variant.glb for
// standard, variant.high.glb for high (a separate file, so a standard build stays valid beside
// a high one).
func variantGLBName(quality meshjobs.Quality) string {
	if quality == meshjobs.QualityHigh {
		return "variant.high.glb"
	}
	return "variant.glb"
}

func variantPath(root *store.Root, id, name string) string {
	meta, _ := root.MatchMetaPath(id)
	return filepath.Join(filepath.Dir(meta), name)
}

func buildMatchVariant(ctx context.Context, root *store.Root, id, game, out string, quality meshjobs.Quality) (meshjobs.BuildResult, error) {
	meta, err := root.MatchMeta(id)
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	if meta.MapModule == "" {
		return meshjobs.BuildResult{}, fmt.Errorf("no map module for match %s", id)
	}
	mode, _, err := matchGameVariantName(root, id)
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	opts := meshbuild.BuildVariantOptions{Map: meta.MapModule, Mvar: variantPath(root, id, "map.mvar"), GameRoot: game, Mode: mode, Quality: quality}
	summary, err := meshbuild.BuildVariant(ctx, opts, out, nil)
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	return meshjobs.BuildResult{Bytes: summary.Bytes, Triangles: summary.Triangles}, nil
}

// matchGameVariantName reads a stored match's game variant name (its mode) from stats.json; a
// missing file reports ok false, never an error.
func matchGameVariantName(root *store.Root, id string) (string, bool, error) {
	stats, err := os.ReadFile(variantPath(root, id, "stats.json"))
	if os.IsNotExist(err) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	var facts struct {
		GameVariantName string `json:"gameVariantName"`
	}
	if err = json.Unmarshal(stats, &facts); err != nil {
		return "", false, err
	}
	return facts.GameVariantName, true, nil
}

func (h serverHandlers) variantMatch(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid match id"})
		return "", false
	}
	_, err := h.root.MatchMeta(id)
	if errors.Is(err, store.ErrNotFound) {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "match_not_found", "id": id})
		return "", false
	}
	if err != nil {
		slog.Error("match meta", "id", id, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
		return "", false
	}
	return id, true
}

func (h serverHandlers) variantHasMvar(w http.ResponseWriter, id string) bool {
	if hasMatchMvar(h.root, id) {
		return true
	}
	_, err := os.Stat(variantPath(h.root, id, "map.mvar"))
	if !errors.Is(err, os.ErrNotExist) {
		slog.Error("stat map variant", "id", id, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
		return false
	}
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "variant_no_mvar", "id": id})
	return false
}

func (h serverHandlers) handleVariant(w http.ResponseWriter, r *http.Request) {
	id, ok := h.variantMatch(w, r)
	if !ok {
		return
	}
	quality, ok := meshQualityFromRequest(w, r)
	if !ok {
		return
	}
	name := variantGLBName(quality)
	f, err := os.Open(variantPath(h.root, id, name))
	if errors.Is(err, os.ErrNotExist) {
		if h.variantHasMvar(w, id) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "variant_not_built", "id": id})
		}
		return
	}
	if err != nil {
		slog.Error("open variant", "id", id, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal_error"})
		return
	}
	defer f.Close()
	serveRevalidated(w, r, name, f)
}

func (h serverHandlers) handleVariantState(w http.ResponseWriter, r *http.Request) {
	id, ok := h.variantMatch(w, r)
	if !ok {
		return
	}
	quality, ok := meshQualityFromRequest(w, r)
	if !ok {
		return
	}
	if _, err := os.Stat(variantPath(h.root, id, variantGLBName(quality))); errors.Is(err, os.ErrNotExist) && !h.variantHasMvar(w, id) {
		return
	}
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, meshStateJSON(h.jobs.Snapshot(variantJobKey(id, quality))))
}

func (h serverHandlers) handleVariantBuild(w http.ResponseWriter, r *http.Request) {
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
	if !h.variantHasMvar(w, id) {
		return
	}
	if h.jobs == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	snap := h.jobs.Enqueue(variantJobKey(id, quality))
	status := http.StatusAccepted
	if snap.Ready() {
		status = http.StatusOK
	}
	writeJSON(w, status, meshStateJSON(snap))
}
