// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package store is the standalone's match storage: a plain folder on disk (no database, no
// accounts). A match lives under matches\<id>\ (chunks, the optional manifest and stats,
// the built replay document and a small match.json summary); a map's geometry lives under
// maps\<moduleKey>.glb. Paths are validated so no match id can escape the data directory.
package store

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
)

// Root is the data directory and the operations over it.
type Root struct {
	dir string
}

// New opens the data directory at dir, creating it (and the matches/ and maps/ subfolders)
// if absent.
func New(dir string) (*Root, error) {
	if dir == "" {
		return nil, fmt.Errorf("data directory is required")
	}
	for _, sub := range []string{dir, filepath.Join(dir, "matches"), filepath.Join(dir, "maps")} {
		if err := os.MkdirAll(sub, 0o755); err != nil {
			return nil, fmt.Errorf("create data directory %s: %w", sub, err)
		}
	}
	return &Root{dir: dir}, nil
}

// Dir returns the data directory.
func (r *Root) Dir() string { return r.dir }

// MatchesDir returns the matches/ folder.
func (r *Root) MatchesDir() string { return filepath.Join(r.dir, "matches") }

// MapsDir returns the maps/ folder.
func (r *Root) MapsDir() string { return filepath.Join(r.dir, "maps") }

// MatchIDValid says whether id is a legal match id: hex and dashes only (a uuid or its
// short8 form), non-empty. It is the guard that keeps a match id from reaching a file path.
func MatchIDValid(id string) bool {
	if id == "" || len(id) > 64 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		switch {
		case c >= '0' && c <= '9', c >= 'a' && c <= 'f', c >= 'A' && c <= 'F', c == '-':
		default:
			return false
		}
	}
	return true
}

// ModuleKeyValid says whether moduleKey names a map mesh without escaping the data
// directory: non-empty, at most 128 bytes, and free of path separators, a volume colon,
// and NUL. It is looser than a match id (module keys like "sgh_interlock" carry non-hex
// letters) but still refuses any byte that could bend a path.
func ModuleKeyValid(moduleKey string) bool {
	if moduleKey == "" || len(moduleKey) > 128 {
		return false
	}
	for i := 0; i < len(moduleKey); i++ {
		c := moduleKey[i]
		if c == '/' || c == '\\' || c == ':' || c == 0 {
			return false
		}
	}
	return true
}

// matchDir validates id and returns the match's folder (matches\<id>).
func (r *Root) matchDir(id string) (string, error) {
	if !MatchIDValid(id) {
		return "", fmt.Errorf("invalid match id %q (hex and dashes only)", id)
	}
	return filepath.Join(r.MatchesDir(), id), nil
}

// MatchChunksDir is the match's chunks/ folder.
func (r *Root) MatchChunksDir(id string) (string, error) {
	d, err := r.matchDir(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "chunks"), nil
}

// MatchManifestPath is the match's manifest.json (optional).
func (r *Root) MatchManifestPath(id string) (string, error) {
	d, err := r.matchDir(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "manifest.json"), nil
}

// MatchStatsPath is the match's stats.json (optional).
func (r *Root) MatchStatsPath(id string) (string, error) {
	d, err := r.matchDir(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "stats.json"), nil
}

// MatchReplayPath is the match's built document, replay.json.gz.
func (r *Root) MatchReplayPath(id string) (string, error) {
	d, err := r.matchDir(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "replay.json.gz"), nil
}

// MatchMetaPath is the match's summary, match.json.
func (r *Root) MatchMetaPath(id string) (string, error) {
	d, err := r.matchDir(id)
	if err != nil {
		return "", err
	}
	return filepath.Join(d, "match.json"), nil
}

// MeshPath is a map's geometry file for a texture quality: maps\<moduleKey>.glb for standard,
// maps\<moduleKey>.high.glb for high (a separate file, so a standard build stays valid beside a
// high one). The module key is validated so it cannot escape the data directory either.
func (r *Root) MeshPath(moduleKey string, q meshjobs.Quality) (string, error) {
	if !ModuleKeyValid(moduleKey) {
		return "", fmt.Errorf("invalid map module key %q", moduleKey)
	}
	name := moduleKey + "." + string(q) + ".glb"
	if q == meshjobs.QualityStandard {
		name = moduleKey + ".glb"
	}
	return filepath.Join(r.MapsDir(), name), nil
}

// BVHPath is a map's ray/collision index sidecar for a texture quality, alongside its mesh
// (maps\<moduleKey>.bvh for standard, maps\<moduleKey>.high.bvh for high — the same split as
// MeshPath, since each quality's mesh is a different file with its own geometry order). The
// client (three-mesh-bvh) builds and serializes it; the server only stores and serves the bytes.
func (r *Root) BVHPath(moduleKey string, q meshjobs.Quality) (string, error) {
	if !ModuleKeyValid(moduleKey) {
		return "", fmt.Errorf("invalid map module key %q", moduleKey)
	}
	name := moduleKey + "." + string(q) + ".bvh"
	if q == meshjobs.QualityStandard {
		name = moduleKey + ".bvh"
	}
	return filepath.Join(r.MapsDir(), name), nil
}

// WriteFile writes data to path atomically (a temp file in the same directory, then
// rename), creating parent directories. A crash mid-write never leaves a torn file.
func (r *Root) WriteFile(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-"+filepath.Base(path)+"-")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }() // no-op after a successful rename
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, path)
}

// WriteCopy copies srcFile to dst atomically (a streamed temp file, then rename).
func (r *Root) WriteCopy(dst, srcFile string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
		return err
	}
	src, err := os.Open(srcFile)
	if err != nil {
		return err
	}
	defer src.Close()
	tmp, err := os.CreateTemp(filepath.Dir(dst), ".tmp-"+filepath.Base(dst)+"-")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer func() { _ = os.Remove(tmpName) }()
	if _, err := io.Copy(tmp, src); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, dst)
}

// ErrNotFound is a match or map absent from the store.
var ErrNotFound = errors.New("not found in store")
