// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package meshbuild

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/texcompress"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// capsOfQuality is a build's texture read sizes for its quality: high doubles the standard
// sides (himap.CapsHigh); everything else is standard (himap.CapsStandard, today's output).
func capsOfQuality(q meshjobs.Quality) himap.TextureCaps {
	if q == meshjobs.QualityHigh {
		return himap.CapsHigh
	}
	return himap.CapsStandard
}

// texturesOf is a build's image format: `f`, or texcompress.DefaultFormat when empty.
func texturesOf(f texcompress.Format) texcompress.Format {
	if f == "" {
		return texcompress.DefaultFormat
	}
	return f
}

// BuildMap builds the native map `module`'s world mesh of texture quality `quality` and writes
// it to `out`, its images in `textures` (empty: texcompress.DefaultFormat). `gameRoot` is the game's deploy root; empty resolves it the way the game-file
// reading chain always does (himap.DeployRoot: the LEVELUP_HALO_DEPLOY environment variable,
// else auto-detected Steam or Xbox installs). `announce` (nil accepted) receives each build
// step at its start.
func BuildMap(ctx context.Context, module string, quality meshjobs.Quality, textures texcompress.Format, gameRoot, out string, announce func(mapmesh.Step)) (mapmesh.Summary, error) {
	if gameRoot == "" {
		root, err := himap.DeployRoot()
		if err != nil {
			return mapmesh.Summary{}, fmt.Errorf("game install: %w", err)
		}
		gameRoot = root
	}
	levelsDir := filepath.Join(gameRoot, "pc", "levels", "multi")
	target, err := ResolveTarget(module, gameRoot, levelsDir)
	if err != nil {
		return mapmesh.Summary{}, err
	}
	target.TextureCaps = capsOfQuality(quality)
	target.Textures = texturesOf(textures)
	return mapmesh.Build(ctx, gameRoot, target, out, generatorTag, announce)
}

// generatorTag is written into every built GLB's extras, naming the chain that produced it.
const generatorTag = "cmd/infinite-theater-3d build-mesh (halo-infinite-map-images, render mesh triangles)"
