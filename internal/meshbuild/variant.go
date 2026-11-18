// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package meshbuild

// variant.go resolves a map variant's (.mvar) object-layer build target and writes its GLB.
//
// Ported from LevelUp's cmd/mapmesh-build/variante.go module resolution (AGPL-3.0, JGtm): a
// variant's rendered geometry lives on one of three modules, tried in order — the map key's own
// installed module, the Forge canvas its catalog entry (himap.CartesForge) names, or (a
// community Forge canvas the catalog has not yet named) the canvas named by the variant's own
// level_id, the same eight-canvas table LevelUp hardcodes.

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/mapref"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/texcompress"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

// canvasByLevelID: the 8 installed Forge canvases, keyed by their variant's level_id, for a
// variant whose map key names neither its own installed module nor a himap.CartesForge entry.
var canvasByLevelID = map[int32]string{
	-747133697:  himap.CanevasSpace,
	1804860316:  himap.CanevasDesert,
	2123870979:  himap.CanevasDeepsea,
	88891201:    himap.CanevasWetland,
	1437677928:  himap.CanevasAcademy,
	-1110087915: himap.CanevasDeadland,
	426470249:   himap.CanevasBlank,
	-992358985:  himap.CanevasFrost,
}

// CanvasOfLevelID names the Forge canvas a variant's level_id designates; false for none.
func CanvasOfLevelID(levelID int32) (string, bool) {
	c, ok := canvasByLevelID[levelID]
	return c, ok
}

// BuildVariantOptions names a variant object-layer build's inputs.
type BuildVariantOptions struct {
	// DebugObjects includes Forge object identities in node names.
	DebugObjects bool
	// Map is the variant's map key: an installed module's folder name, or a Forge map's map_id
	// (himap.CartesForge).
	Map string
	// Mvar is the path to the variant's `.mvar` file; this tool never fetches one itself (the
	// caller downloads it).
	Mvar string
	// GameRoot is the game's deploy root; empty resolves it the way build-mesh does
	// (himap.DeployRoot: LEVELUP_HALO_DEPLOY, else auto-detected Steam or Xbox).
	GameRoot string
	// ForgeMaterials and ForgeObjects are optional reference catalog file paths (see
	// mapmesh.VariantTarget); empty uses the catalogs embedded in this binary (mapref).
	ForgeMaterials, ForgeObjects string
	// Mode is the match's game variant name; the layer holds the objects that mode creates
	// (mapmesh.ModeFilters). Empty builds it for a match without a known mode.
	Mode string
	// Quality is the texture quality to read at (meshjobs.Quality); standard is the default
	// (today's output).
	Quality meshjobs.Quality
	// Textures is the GLB's image format; empty is texcompress.DefaultFormat.
	Textures texcompress.Format
}

// BuildVariant builds a map variant's object-layer GLB and writes it to `out`.
func BuildVariant(ctx context.Context, opts BuildVariantOptions, out string, announce func(mapmesh.Step)) (mapmesh.Summary, error) {
	gameRoot := opts.GameRoot
	if gameRoot == "" {
		root, err := himap.DeployRoot()
		if err != nil {
			return mapmesh.Summary{}, fmt.Errorf("game install: %w", err)
		}
		gameRoot = root
	}
	blob, err := os.ReadFile(opts.Mvar) //nolint:gosec // cache path, set by the caller
	if err != nil {
		return mapmesh.Summary{}, fmt.Errorf("variant file: %w", err)
	}
	v, err := mapvar.Parse(blob)
	if err != nil {
		return mapmesh.Summary{}, fmt.Errorf("variant %s: %w", opts.Map, err)
	}
	levelsDir := filepath.Join(gameRoot, "pc", "levels", "multi")
	module, err := resolveVariantModule(opts.Map, v.LevelID, levelsDir)
	if err != nil {
		return mapmesh.Summary{}, err
	}
	materials, err := forgeMaterialsCatalog(opts.ForgeMaterials)
	if err != nil {
		return mapmesh.Summary{}, err
	}
	objects, err := forgeObjectsCatalog(opts.ForgeObjects)
	if err != nil {
		return mapmesh.Summary{}, err
	}
	target := mapmesh.VariantTarget{
		Key: opts.Map, Module: module, Objects: v.Objects, Styles: v.Styles, StyleGrimes: v.StyleGrimes,
		ForgeMaterials: materials, ForgeObjects: objects, Mode: opts.Mode, TextureCaps: capsOfQuality(opts.Quality),
		Textures: texturesOf(opts.Textures), DebugObjects: opts.DebugObjects,
	}
	return mapmesh.BuildVariant(ctx, gameRoot, target, out, generatorTagVariant, announce)
}

// forgeMaterialsCatalog resolves the Forge material tints catalog: `path` if given, else the
// catalog embedded in this binary (mapref.DefaultForgeMaterials).
func forgeMaterialsCatalog(path string) ([]byte, error) {
	if path != "" {
		data, err := os.ReadFile(path) //nolint:gosec // reference catalog path, set by the caller
		if err != nil {
			return nil, fmt.Errorf("forge materials: %w", err)
		}
		return data, nil
	}
	return mapref.DefaultForgeMaterials()
}

// forgeObjectsCatalog resolves the Forge object visibility catalog: `path` if given, else the
// catalog embedded in this binary (mapref.DefaultForgeObjects).
func forgeObjectsCatalog(path string) ([]byte, error) {
	if path != "" {
		data, err := os.ReadFile(path) //nolint:gosec // reference catalog path, set by the caller
		if err != nil {
			return nil, fmt.Errorf("forge objects: %w", err)
		}
		return data, nil
	}
	return mapref.DefaultForgeObjects()
}

// resolveVariantModule resolves the installed `.module` that carries `mapKey`'s rendered
// geometry. See the package doc comment for the three paths tried, in order.
func resolveVariantModule(mapKey string, levelID int32, levelsDir string) (string, error) {
	if p := modulePathIn(levelsDir, mapKey); p != "" {
		return p, nil
	}
	for _, c := range himap.CartesForge {
		if c.MapID == mapKey {
			if p := modulePathIn(levelsDir, c.ModuleCanevas); p != "" {
				return p, nil
			}
		}
	}
	if canvas, ok := canvasByLevelID[levelID]; ok {
		if p := modulePathIn(levelsDir, canvas); p != "" {
			return p, nil
		}
	}
	return "", fmt.Errorf("variant %s: no installed module (level_id %d)", mapKey, levelID)
}

// modulePathIn returns the installed `.module` path for `key` under `levelsDir`, or "" if it is
// not installed.
func modulePathIn(levelsDir, key string) string {
	p := filepath.Join(levelsDir, key, key+"-rtx-new.module")
	if _, err := os.Stat(p); err != nil {
		return ""
	}
	return p
}

// generatorTagVariant is written into every built variant GLB's extras, naming the chain that
// produced it.
const generatorTagVariant = "cmd/infinite-theater-3d build-variant (halo-infinite-map-images, variant object layer)"
