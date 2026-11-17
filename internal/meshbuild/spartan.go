// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package meshbuild

// spartan.go resolves the Spartan body's build target and writes its GLB.
//
// Ported from LevelUp's cmd/mapmesh-build module resolution for the Spartan model
// (meshproto.CleSpartan, AGPL-3.0, JGtm): the Spartan render_model and its animation graphs live
// in the game's shared `globals`/`common` modules, so the caller names the map whose installed
// module to open the index from (same pattern as BuildWeapon).

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// BuildSpartanOptions names a Spartan body build's inputs.
type BuildSpartanOptions struct {
	// Map is any installed map's module key; its index covers the game's globals.
	Map string
	// GameRoot is the game's deploy root; empty resolves it the way build-mesh does.
	GameRoot string
}

// BuildSpartan builds the Spartan body's animated GLB and writes it to `out`.
func BuildSpartan(ctx context.Context, opts BuildSpartanOptions, out string, announce func(mapmesh.Step)) (mapmesh.Summary, error) {
	gameRoot := opts.GameRoot
	if gameRoot == "" {
		root, err := himap.DeployRoot()
		if err != nil {
			return mapmesh.Summary{}, fmt.Errorf("game install: %w", err)
		}
		gameRoot = root
	}
	levelsDir := filepath.Join(gameRoot, "pc", "levels", "multi")
	module := modulePathIn(levelsDir, opts.Map)
	if module == "" {
		return mapmesh.Summary{}, fmt.Errorf("spartan body: map %q is not installed", opts.Map)
	}
	target := mapmesh.SpartanTarget{Module: module}
	return mapmesh.BuildSpartan(ctx, gameRoot, target, out, generatorTagSpartan, announce)
}

// generatorTagSpartan is written into every built Spartan body GLB's extras, naming the chain
// that produced it.
const generatorTagSpartan = "cmd/infinite-theater-3d build-spartan (halo-infinite-map-images, spartan body)"
