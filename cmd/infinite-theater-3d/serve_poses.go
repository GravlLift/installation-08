// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_poses.go — the Spartan pose catalog on the server: GET /api/spartan/poses lists the
// Spartan's pose clips (intro emotes, Spartan ID stances, menu/lobby idles) from the Spartan's
// animation graphs, and GET /api/spartan/poses/{id} serves one of them as a small GLB, cached
// under <data>/poses beside the weapon library's own files. The catalog is built once per
// server run, lazily; the arsenal and the Spartan skin are opened for the build and closed
// after.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// errGameUnavailable is the poseSource answer the routes translate into
// 503 {"error":"game_unavailable"}.
var errGameUnavailable = errors.New("game not installed")

// poseSource keeps the expensive game work (open the arsenal, build the Spartan skin, decode a
// clip) behind one interface so the routes are testable with a fake.
type poseSource interface {
	List(ctx context.Context) ([]mapmesh.Pose, error)
	GLB(ctx context.Context, id string) ([]byte, error)
}

// gamePoseSource is the poseSource on the installed game. The arsenal and the Spartan skin are
// opened per call and closed after; the GLB route caches the bytes, so the open happens once
// per pose.
type gamePoseSource struct{}

func (s *gamePoseSource) List(ctx context.Context) ([]mapmesh.Pose, error) {
	a, m, err := openSpartanForPoses(ctx)
	if err != nil {
		return nil, err
	}
	defer closeSpartanArsenal(ctx, a)
	return mapmesh.ListSpartanPoses(ctx, a, m.Noeuds)
}

func (s *gamePoseSource) GLB(ctx context.Context, id string) ([]byte, error) {
	a, m, err := openSpartanForPoses(ctx)
	if err != nil {
		return nil, err
	}
	defer closeSpartanArsenal(ctx, a)
	pos, err := mapmesh.ListSpartanPoses(ctx, a, m.Noeuds)
	if err != nil {
		return nil, err
	}
	var pose *mapmesh.Pose
	for i := range pos {
		if pos[i].ID == id {
			pose = &pos[i]
			break
		}
	}
	if pose == nil {
		return nil, fmt.Errorf("pose %s: not in the catalog", id)
	}
	var buf bytes.Buffer
	if err := mapmesh.WritePoseGLB(ctx, a, m, *pose, &buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// openSpartanForPoses opens the game (the auto-detected deploy root, the first installed map's
// module: the Spartan's graphs live in pc/globals, covered by every installed module) and
// builds the Spartan skin. Every failure to reach the game is errGameUnavailable.
func openSpartanForPoses(ctx context.Context) (*himap.Arsenal, *himap.ModeleAPeau, error) {
	gameRoot, err := himap.DeployRoot()
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %v", errGameUnavailable, err)
	}
	module, ok := weapons.FirstInstalledModule(gameRoot)
	if !ok {
		return nil, nil, fmt.Errorf("%w: no installed map", errGameUnavailable)
	}
	a, err := himap.OuvreArsenal(gameRoot, module)
	if err != nil {
		return nil, nil, fmt.Errorf("%w: %v", errGameUnavailable, err)
	}
	m, err := a.ModeleAPeau(ctx, himap.ModeSpartan)
	if err != nil {
		_ = a.Close()
		return nil, nil, fmt.Errorf("%w: %v", errGameUnavailable, err)
	}
	return a, m, nil
}

// closeSpartanArsenal closes a (ctx, a) opened by openSpartanForPoses.
func closeSpartanArsenal(ctx context.Context, a *himap.Arsenal) {
	if err := a.Close(); err != nil {
		slog.WarnContext(ctx, "closing arsenal", "err", err)
	}
}

// poseStore serves the pose routes: the catalog is built once per server run, lazily, under a
// mutex; the pose GLBs are cached as files under <data>/poses.
type poseStore struct {
	mu    sync.Mutex
	src   poseSource
	root  *store.Root
	poses []mapmesh.Pose
	built bool
}

func newPoseStore(root *store.Root, src poseSource) *poseStore {
	return &poseStore{src: src, root: root}
}

// catalog builds the pose list once, on success, and returns it; a failed build is not
// cached, so a later request retries it (the game may come to be reachable).
func (s *poseStore) catalog(ctx context.Context) ([]mapmesh.Pose, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.built {
		return s.poses, nil
	}
	poses, err := s.src.List(ctx)
	if err != nil {
		return nil, err
	}
	s.built = true
	s.poses = poses
	return poses, nil
}

// handleSpartanPoses answers GET /api/spartan/poses with {"poses":[...]}.
func (h serverHandlers) handleSpartanPoses(w http.ResponseWriter, r *http.Request) {
	pos, err := h.poses.catalog(r.Context())
	if err != nil {
		writePoseError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"poses": pos})
}

// handleSpartanPose answers GET /api/spartan/poses/{id} with the pose's GLB
// (Content-Type: model/gltf-binary), cached as a file under <data>/poses.
func (h serverHandlers) handleSpartanPose(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !poseIDValid(id) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid pose id"})
		return
	}
	pos, err := h.poses.catalog(r.Context())
	if err != nil {
		writePoseError(w, err)
		return
	}
	var pose *mapmesh.Pose
	for i := range pos {
		if pos[i].ID == id {
			pose = &pos[i]
			break
		}
	}
	if pose == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "pose_not_found"})
		return
	}
	path := filepath.Join(h.root.Dir(), "poses", poseCacheName(id))
	if _, err := os.Stat(path); err == nil {
		servePoseFile(w, r, path)
		return
	}
	glb, err := h.poses.src.GLB(r.Context(), id)
	if err != nil {
		slog.Error("spartan pose GLB build failed", "id", id, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if err := h.root.WriteFile(path, glb); err != nil {
		slog.Error("spartan pose GLB cache write failed", "id", id, "err", err)
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	servePoseFile(w, r, path)
}

// servePoseFile serves one cached pose GLB (range-capable) as a glTF binary.
func servePoseFile(w http.ResponseWriter, r *http.Request, path string) {
	w.Header().Set("Content-Type", "model/gltf-binary")
	http.ServeFile(w, r, path)
}

// writePoseError answers a catalog error: the game-unavailable one with
// 503 {"error":"game_unavailable"}, the rest with a 500.
func writePoseError(w http.ResponseWriter, err error) {
	if errors.Is(err, errGameUnavailable) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "game_unavailable"})
		return
	}
	slog.Error("spartan pose catalog failed", "err", err)
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
}

// poseCacheName is the file name of a pose's cached GLB: the id's SHA-256 in hex with a .glb
// extension. The id's ":" and "-" are not safe in Windows file names (the cache writer names
// its temp file after the target), and the hash keeps the mapping one-to-one.
func poseCacheName(id string) string {
	sum := sha256.Sum256([]byte(id))
	return fmt.Sprintf("%x.glb", sum)
}

// poseIDValid says whether id fits the Pose.ID character rule: non-empty, only [a-z0-9_:-].
func poseIDValid(id string) bool {
	for _, r := range id {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_', r == ':', r == '-':
		default:
			return false
		}
	}
	return id != ""
}
