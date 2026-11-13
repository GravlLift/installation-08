package mapmesh

// variant.go ports LevelUp's internal/mapmesh/variante.go (AGPL-3.0, JGtm): a map variant's
// object layer, the crates, cover and accessories a `.mvar` places that neither the map's own
// structure nor its scenario do. A native map ships with its own variant; a Forge map has only
// this layer on its canvas. Same MaillageMonde, same writer (himap.EcritGLB) as the map mesh,
// without a sun or lighting: those are the map's own (see mapmesh.go, sky.go).

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"

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
	// ForgeMaterials is a reference catalog of Forge material tints (JSON; not shipped by this
	// repo, see NOTICE.md); empty skips tinting (objects come out in their default material
	// color).
	ForgeMaterials string
	// ForgeObjects is a reference catalog of Forge object visibility (JSON; not shipped by this
	// repo); empty keeps every placed object visible, including Forge's own editor-only markers.
	ForgeObjects string
}

// BuildVariant writes the variant's object-layer GLB to `path`, built in-process from the local
// game installation and `t`'s parsed `.mvar` objects. `announce` (nil accepted) receives each
// step at its start.
func BuildVariant(ctx context.Context, gameRoot string, t VariantTarget, path, generator string, announce func(Step)) (Summary, error) {
	if announce == nil {
		announce = func(Step) {}
	}
	announce(StepGeometry)
	tints, err := forgeTints(t.ForgeMaterials, t.Styles)
	if err != nil {
		return Summary{}, err
	}
	invisible, err := forgeInvisible(t.ForgeObjects)
	if err != nil {
		return Summary{}, err
	}
	m, bilan, err := himap.CollecteMaillageVariante(ctx, himap.OptionsVariante{
		RacineDeploy: gameRoot, CheminModule: t.Module, Objets: t.Objects, Teintes: tints, Invisibles: invisible,
	})
	if err != nil {
		return Summary{}, err
	}
	announce(StepWriting)
	extras := map[string]any{"mapId": t.Key, "module": filepath.Base(t.Module), axesGLBKey: axesGLB, "objects": bilan.Poses}
	n, err := writeFile(path, func(w io.Writer) error { return himap.EcritGLB(w, m, generator, extras) })
	if err != nil {
		return Summary{}, err
	}
	s := Summary{Triangles: m.Structure.Triangles(), Bytes: n}
	slog.InfoContext(ctx, "variant object layer written", "mapId", t.Key, "objects", bilan.Poses,
		"triangles", s.Triangles, "bytes", n, "file", filepath.Base(path))
	return s, nil
}

// forgeTints reads the Forge material tints catalog at `path` (see VariantTarget.ForgeMaterials);
// an empty path skips tinting (nil, nil).
func forgeTints(path string, styles map[int32][]mapvar.StyleLayer) (map[int32]himap.TeinteForge, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path) //nolint:gosec // reference catalog path, set by the caller
	if err != nil {
		return nil, fmt.Errorf("forge materials: %w", err)
	}
	return himap.LitMateriauxForge(data, styles)
}

// forgeInvisible reads the Forge object visibility catalog at `path` (see
// VariantTarget.ForgeObjects); an empty path keeps every object visible (nil, nil).
func forgeInvisible(path string) (map[himap.CleObjetVariante]bool, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path) //nolint:gosec // reference catalog path, set by the caller
	if err != nil {
		return nil, fmt.Errorf("forge objects: %w", err)
	}
	return ForgeHiddenObjects(data)
}
