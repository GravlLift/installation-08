package meshbuild

// forge.go resolves the world mesh of a map built in Forge from the match's own map variant.
//
// THE RULE. A Forge map is a variant (`.mvar`) placed on one of the eight installed Forge canvases;
// the variant's level_id names the canvas (canvasByLevelID). Its world is two layers that never
// draw the same thing:
//   - the world mesh: the CANVAS's own geometry (its structure instances, terrain and scenario
//     placements, its sun), the same build as a native map's (mapmesh.Build), on the canvas module;
//   - the variant layer: every object the variant places (BuildVariant), which on a Forge map is
//     the whole built map.
// Both come from the match's own variant, so a playlist copy of a map (its "- Ranked" republish,
// under a new asset id) needs no table entry. The canvas carries distant scenery far beyond any
// map built on it, so the mesh is kept to a frame around where the map is played: the variant's
// objective anchors, widened by himap.MargeCadreAncres (the margin himap keeps around anchors
// used as a frame), the same anchors choosing the played bsp. Two maps on one canvas frame it
// differently, so the mesh is keyed by the map's asset id, never by the canvas module (which stays
// the module key of the builds that only need an installed module: weapons, first person, pieces).

import (
	"context"
	"encoding/json"
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

// IsForgeCanvas reports whether `module` is one of the installed Forge canvases.
func IsForgeCanvas(module string) bool {
	for _, c := range canvasByLevelID {
		if c == module {
			return true
		}
	}
	return false
}

// ForgeMapOptions names a Forge map world-mesh build's inputs.
type ForgeMapOptions struct {
	// Key is the mesh's key, published in the GLB: the map's asset id.
	Key string
	// Names are the map's displayed names, published in the GLB.
	Names []string
	// Mvar is the path to the match's map variant file.
	Mvar string
	// GameRoot is the game's deploy root; empty resolves it as BuildMap does.
	GameRoot string
	// Quality is the texture quality to read at (meshjobs.Quality); standard is the default
	// (today's output).
	Quality meshjobs.Quality
	// Textures is the GLB's image format; empty is texcompress.DefaultFormat.
	Textures texcompress.Format
}

// BuildForgeMap builds a Forge map's world mesh (see the file comment) and writes it to `out`.
func BuildForgeMap(ctx context.Context, opts ForgeMapOptions, out string, announce func(mapmesh.Step)) (mapmesh.Summary, error) {
	gameRoot := opts.GameRoot
	if gameRoot == "" {
		root, err := himap.DeployRoot()
		if err != nil {
			return mapmesh.Summary{}, fmt.Errorf("game install: %w", err)
		}
		gameRoot = root
	}
	blob, err := os.ReadFile(opts.Mvar) //nolint:gosec // store path, set by the caller
	if err != nil {
		return mapmesh.Summary{}, fmt.Errorf("variant file: %w", err)
	}
	v, err := mapvar.Parse(blob)
	if err != nil {
		return mapmesh.Summary{}, fmt.Errorf("variant %s: %w", opts.Key, err)
	}
	target, err := ResolveForgeTarget(opts.Key, opts.Names, v, filepath.Join(gameRoot, "pc", "levels", "multi"))
	if err != nil {
		return mapmesh.Summary{}, err
	}
	catalog, err := mapref.DefaultForgeMaterials()
	if err != nil {
		return mapmesh.Summary{}, err
	}
	if target.SunIntensity, target.SunColor, err = forgeSun(v.Lighting, catalog); err != nil {
		return mapmesh.Summary{}, err
	}
	target.SunAzimuth, target.SunLatitude = forgeSunDirection(v.Lighting)
	target.TextureCaps = capsOfQuality(opts.Quality)
	target.Textures = texturesOf(opts.Textures)
	return mapmesh.Build(ctx, gameRoot, target, out, generatorTagForge, announce)
}

// forgeSun returns the sun strength a Forge map's own lighting options set over its canvas's: the
// Sunlight intensity, and the Sunlight color override when it is switched on (mapvar.Lighting),
// resolved in the Forge globals' color list (`catalog`, forge_materials.json "colors") and scaled
// to a peak of 1 (the scenario suns' convention; the intensity carries the strength). nil for
// what the variant does not set.
func forgeSun(l *mapvar.Lighting, catalog []byte) (*float64, *[3]float64, error) {
	if l == nil {
		return nil, nil, nil
	}
	var color *[3]float64
	if l.SunColorSwitch == mapvar.SunColorOverrideOn {
		var doc struct {
			Colors [][3]float64 `json:"colors"`
		}
		if err := json.Unmarshal(catalog, &doc); err != nil {
			return nil, nil, fmt.Errorf("forge colors: %w", err)
		}
		if i := l.SunColorIndex; i >= 0 && i < len(doc.Colors) {
			c := doc.Colors[i]
			if peak := max(c[0], c[1], c[2]); peak > 0 {
				color = &[3]float64{c[0] / peak, c[1] / peak, c[2] / peak}
			}
		}
	}
	return l.SunIntensity, color, nil
}

// forgeSunDirection returns the azimuth and latitude a Forge map's Sun Direction sets over its
// canvas's sun (mapvar.SunDirection: yaw and pitch); nil, nil when the variant sets none. Origin
// (yaw 0, pitch 330) on fo08_wetland (231.8, 71.6) moves its sun from 41.8 degrees of elevation
// at azimuth 141.8 to 36.6 degrees at azimuth 90.
func forgeSunDirection(l *mapvar.Lighting) (azimuth, latitude *float64) {
	if l == nil || l.SunDirection == nil {
		return nil, nil
	}
	yaw, pitch := l.SunDirection.Yaw, l.SunDirection.Pitch
	return &yaw, &pitch
}

// ResolveForgeTarget resolves the world-mesh target of the Forge map whose variant is `v`: its
// canvas module, its objective anchors and the frame around them.
func ResolveForgeTarget(key string, names []string, v *mapvar.Variant, levelsDir string) (mapmesh.Target, error) {
	canvas, ok := canvasByLevelID[v.LevelID]
	if !ok {
		return mapmesh.Target{}, notBuildable("variant %s: level_id %d names no Forge canvas", key, v.LevelID)
	}
	module := modulePathIn(levelsDir, canvas)
	if module == "" {
		return mapmesh.Target{}, notBuildable("Forge canvas %s not installed", canvas)
	}
	anchors := variantAnchors(v)
	frame, ok := himap.BoiteDesAncres(anchors, himap.MargeCadreAncres)
	if !ok {
		return mapmesh.Target{}, notBuildable("variant %s places no objective: no anchor to frame its canvas", key)
	}
	return mapmesh.Target{Key: key, Module: module, MapModule: module, Names: names, Anchors: anchors, Frame: frame}, nil
}

// variantAnchors returns the world positions of the variant's objectives, deduplicated (an object
// that carries several roles yields one objective per role at one position).
func variantAnchors(v *mapvar.Variant) [][3]float64 {
	seen := map[[3]float64]bool{}
	var out [][3]float64
	for _, o := range v.Objectives() {
		a := [3]float64{o.Pos.X, o.Pos.Y, o.Pos.Z}
		if !seen[a] {
			seen[a] = true
			out = append(out, a)
		}
	}
	return out
}

// generatorTagForge is written into every built Forge world GLB's extras.
const generatorTagForge = "cmd/infinite-theater-3d build-mesh --mvar (halo-infinite-map-images, Forge canvas render mesh triangles)"
