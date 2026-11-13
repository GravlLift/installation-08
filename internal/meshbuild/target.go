// Package meshbuild resolves a native map's build.Target from its installed module key, the
// embedded reference data (internal/mapref) and the local game installation, then runs the
// build in-process (internal/mapmesh).
//
// Ported from LevelUp's cmd/mapmesh-build (AGPL-3.0, JGtm): LevelUp resolved the same target
// from files a running server passed on the command line, to a child process it watched over
// JSON events on stdout (the server itself never links the game-file reading chain). This CLI
// has no server and no sandboxing need to honor, so it resolves the target from the embedded
// reference data and calls mapmesh.Build directly.
package meshbuild

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/mapref"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

// ErrNotBuildable reports a map this tool cannot build, with the reason.
type ErrNotBuildable struct {
	Reason string
}

func (e *ErrNotBuildable) Error() string { return e.Reason }

func notBuildable(format string, args ...any) error {
	return &ErrNotBuildable{Reason: fmt.Sprintf(format, args...)}
}

// ResolveTarget resolves a native map's build target: `module` is its installed folder name
// (the key used throughout the embedded reference data), `gameRoot` the game's deploy root
// and `levelsDir` its "pc" multiplayer levels directory (geometry variant: it carries the
// rendered instances the mesh needs).
func ResolveTarget(module, gameRoot, levelsDir string) (mapmesh.Target, error) {
	moduleKey := module
	for _, m := range himap.CartesForge {
		if m.MapID == module {
			moduleKey = m.ModuleCanevas
			break
		}
	}
	modulePath := filepath.Join(levelsDir, moduleKey, moduleKey+"-rtx-new.module")
	if _, err := os.Stat(modulePath); err != nil {
		return mapmesh.Target{}, notBuildable("module not installed: %v", err)
	}
	background, err := mapref.LoadBackground(module)
	if err != nil {
		return mapmesh.Target{}, notBuildable("%v", err)
	}
	catalog, err := mapref.LoadObjectives()
	if err != nil {
		return mapmesh.Target{}, notBuildable("%v", err)
	}
	anchors := anchorsFor(background.MapNames, catalog)
	if len(anchors) == 0 {
		return mapmesh.Target{}, notBuildable("no objectives catalog entry for %v", background.MapNames)
	}
	override, err := mapref.GeometryOverride(module)
	if err != nil {
		return mapmesh.Target{}, err
	}
	geometry := modulePath
	if override != "" {
		geometry = filepath.Join(gameRoot, filepath.FromSlash(override))
	}
	return mapmesh.Target{
		Key: module, Module: geometry, MapModule: modulePath, Names: background.MapNames, Anchors: anchors,
		Frame: mapmesh.FrameOf(background.Calibration),
	}, nil
}

// anchorsFor returns the objective positions of the catalog entries whose module or public name
// is one of the map's names, deduplicated by position (the ranked and unranked variants of a map
// share most of their objectives).
func anchorsFor(names []string, catalog *replay.MapObjectivesCatalog) [][3]float64 {
	known := map[string]bool{}
	for _, n := range names {
		known[strings.ToLower(n)] = true
	}
	seen := map[[3]float64]bool{}
	var out [][3]float64
	for _, entry := range catalog.Maps {
		if !known[strings.ToLower(entry.Module)] && !known[strings.ToLower(entry.PublicName)] {
			continue
		}
		for _, o := range entry.Objectives {
			a := [3]float64{o.Pos.X, o.Pos.Y, o.Pos.Z}
			if !seen[a] {
				seen[a] = true
				out = append(out, a)
			}
		}
	}
	return out
}

// IsForge reports whether `key` names a Forge map (its map_id) or a Forge canvas.
func IsForge(key string) bool {
	if himap.EstCanevasForge(key) {
		return true
	}
	for _, m := range himap.CartesForge {
		if m.MapID == key {
			return true
		}
	}
	return false
}

// AsNotBuildable reports whether err carries a resolution reason, for callers that want to
// distinguish "not buildable here" from an ordinary error.
func AsNotBuildable(err error) (*ErrNotBuildable, bool) {
	var nb *ErrNotBuildable
	ok := errors.As(err, &nb)
	return nb, ok
}
