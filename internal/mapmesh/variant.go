// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package mapmesh

// variant.go ports LevelUp's internal/mapmesh/variante.go (AGPL-3.0, JGtm): a map variant's
// object layer, the crates, cover and accessories a `.mvar` places that neither the map's own
// structure nor its scenario do. A native map ships with its own variant; a Forge map has only
// this layer on its canvas. Same MaillageMonde, same writer (himap.EcritGLB) as the map mesh,
// without a sun or lighting: those are the map's own (see mapmesh.go, sky.go). Its objects are
// shared models placed by transform (himap.PosesVariante): each model is written once.

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/texcompress"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

// VariantTarget is a map variant's object layer to build.
type VariantTarget struct {
	// Key identifies the variant (its map_id, or the installed map's own key), published in the
	// GLB.
	Key string
	// Module is the `.module` that carries the variant's rendered geometry: the installed map's
	// own module, or its Forge canvas.
	Module string
	// Objects are the variant's placed objects (mapvar.Parse).
	Objects []mapvar.Object
	// Styles are the variant's style layers (mapvar.Parse), resolved against ForgeMaterials for
	// material tints.
	Styles map[int32][]mapvar.StyleLayer
	// StyleGrimes are the variant's style grimes (mapvar.Parse), resolved with Styles against
	// ForgeMaterials into the styles that repaint the objects' layered materials.
	StyleGrimes map[int32]mapvar.StyleGrime
	// ForgeMaterials is a reference catalog of Forge material tints (JSON), resolved by the
	// caller (embedded default or a --forge-materials override); nil skips tinting (objects come
	// out in their default material color).
	ForgeMaterials []byte
	// ForgeObjects is a reference catalog of Forge object visibility (JSON), resolved by the
	// caller; nil keeps every placed object visible, including Forge's own editor-only markers.
	ForgeObjects []byte
	// Mode is the match's game variant name ("Ranked:Slayer"): the layer holds the objects that
	// mode creates (ModeFilters). Empty builds the layer of a match without a known mode.
	Mode string
	// TextureCaps is the build's texture read sizes (himap.TextureCaps); zero is the standard
	// caps (himap.CapsStandard), today's output.
	TextureCaps himap.TextureCaps
	// Textures is the image format of the written GLB (see Target.Textures).
	Textures texcompress.Format
}

// BuildVariant writes the variant's object-layer GLB to `path`, built in-process from the local
// game installation and `t`'s parsed `.mvar` objects. `announce` (nil accepted) receives each
// step at its start.
func BuildVariant(ctx context.Context, gameRoot string, t VariantTarget, path, generator string, announce func(Step)) (Summary, error) {
	if announce == nil {
		announce = func(Step) {}
	}
	prog := progressOf(ctx, t.Textures == texcompress.FormatKTX2)
	// note announces a step and reports it as progress (the runner's reporter, nil-safe).
	note := func(s Step) {
		announce(s)
		prog.stage(s)
	}
	note(StepGeometry)
	tints, err := forgeTints(t.ForgeMaterials, t.Styles)
	if err != nil {
		return Summary{}, err
	}
	styles, err := forgeStyles(t.ForgeMaterials, t.Styles, t.StyleGrimes)
	if err != nil {
		return Summary{}, err
	}
	invisible, err := forgeInvisible(t.ForgeObjects)
	if err != nil {
		return Summary{}, err
	}
	opts := himap.OptionsVariante{
		RacineDeploy: gameRoot, CheminModule: t.Module, Objets: t.Objects, Teintes: tints, Invisibles: invisible,
		StylesForge: styles, Filtres: ModeFilters(t.Mode), TextureCaps: t.TextureCaps,
	}
	if t.ForgeMaterials != nil {
		// The game's own Forge palette resolves every style swatch; the catalog only fills the
		// swatches it does not name (it is a lossy export of that palette).
		opts.StylesMvar, opts.SaletesMvar, opts.CatalogueForge = t.Styles, t.StyleGrimes, t.ForgeMaterials
	}
	m, bilan, err := himap.CollecteMaillageVariante(ctx, opts)
	if err != nil {
		return Summary{}, err
	}
	note(StepWriting)
	extras := map[string]any{"mapId": t.Key, "module": filepath.Base(t.Module), "objects": bilan.Poses}
	for k, v := range commonExtras() {
		extras[k] = v
	}
	// Read before writing, so the texture pass does not keep the collected layer alive.
	placed, unique := m.Poses.Triangles()
	models := len(m.Poses.Geometries)
	n, err := writeGLB(ctx, path, t.Key, t.Textures, prog, func(w io.Writer) error { return himap.EcritGLB(w, m, generator, extras) })
	if err != nil {
		return Summary{}, err
	}
	s := Summary{Triangles: placed, Bytes: n}
	slog.InfoContext(ctx, "variant object layer written", "mapId", t.Key, "objects", bilan.Poses,
		"triangles", placed, "uniqueTriangles", unique, "models", models,
		"bytes", n, "file", filepath.Base(path))
	return s, nil
}

// forgeTints resolves the Forge material tints catalog (see VariantTarget.ForgeMaterials); nil
// data skips tinting (nil, nil).
func forgeTints(data []byte, styles map[int32][]mapvar.StyleLayer) (map[int32]himap.TeinteForge, error) {
	if data == nil {
		return nil, nil
	}
	return himap.LitMateriauxForge(data, styles)
}

// forgeStyles resolves the variant's Forge styles (layers and grime) in the Forge material
// catalog, for its objects' layered materials; nil data skips them (nil, nil).
func forgeStyles(data []byte, styles map[int32][]mapvar.StyleLayer, grimes map[int32]mapvar.StyleGrime) (map[int32]*himap.StyleForge, error) {
	if data == nil {
		return nil, nil
	}
	return himap.LitStylesForge(data, styles, grimes)
}

// forgeInvisible resolves the Forge object visibility catalog (see VariantTarget.ForgeObjects);
// nil data keeps every object visible (nil, nil).
func forgeInvisible(data []byte) (map[himap.CleObjetVariante]bool, error) {
	if data == nil {
		return nil, nil
	}
	return ForgeHiddenObjects(data)
}
