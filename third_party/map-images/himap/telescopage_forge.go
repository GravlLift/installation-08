// Package himap — telescopage_forge.go (LOCAL-CHANGE (infinite-theater-3d)): the scale of a
// TELESCOPING Forge object.
//
// A `.mvar` object names its Forge mode at `#8/24[0]/0` (mapvar.Object.ModeForge; 3 is
// telescoping, the value Ekur's add-on calls ForgeObjectMode.Telescoping). A telescoping type
// lists its sizes as representations (one `bloc` and `mode` per size, named by the size in
// decimeters) and its objects choose none: the game fits a size to the object's scale. Along an
// axis on which every size has the same extent the type does not telescope, and the game does
// not stretch it: the component the `.mvar` stores there is not applied.
//
// MEASURED (Outlook, fo13_frost, match 05dfe4e9, player torso samples inside object meshes):
// the eight ring plates around the centre obelisk (type -153902808, sizes 0.8 to 12.8 by 3.2
// or 6.4 m, all 0.41 m thick) store (5.09, 1.28, 5.09); scaling their thickness by 5.09 stood
// them 2.09 m tall, 1.5 m above the floor (10 517 samples inside), unscaled none. Every size of
// the base door frames (690293631) is 0.41 m deep; the 15.4 stored on that depth made a 6.2 m
// tunnel (376 samples inside), unscaled none. Every other mapping of the stored components
// onto the axes keeps samples inside one family or the other.
//
// Ekur (TheHaloArchive, addon/src/operators/forge_map_operator.py) reads the mode for the
// object's name only and scales every object by its stored scale: it does not handle
// telescoping, and its export carries the same slabs.
package himap

import (
	"context"
	"math"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// typesTelescopiques returns the types with at least one telescoping object.
func typesTelescopiques(objets []mapvar.Object) map[int32]bool {
	out := map[int32]bool{}
	for _, o := range objets {
		if o.ModeForge == mapvar.ModeForgeTelescopique {
			out[o.TypeID] = true
		}
	}
	return out
}

// axesFixesDuFood returns, per model axis, whether the sizes of the Forge definition `food`
// (the models of its representations) all have the same extent there (axesFixes).
func axesFixesDuFood(ctx context.Context, idx *ModuleIndex, food []byte, assets map[uint32]*RuntimeGeoAsset) [3]bool {
	var boites [][2][3]float64
	vus := map[uint32]bool{}
	for _, id := range refsRepresentations(food) {
		groupe, _, ok := idx.Lookup(id)
		if !ok {
			continue
		}
		ref := refModele{id: id, groupe: groupe}
		if groupe != GroupeRtgo && groupe != GroupeMode {
			objet, err := idx.Extract(id)
			if err != nil {
				continue
			}
			if ref, ok = modeleDuHlmt(ctx, idx, objet); !ok {
				continue
			}
		}
		if vus[ref.id] {
			continue
		}
		vus[ref.id] = true
		a, deja := assets[ref.id]
		if !deja {
			a = ouvreAsset(ctx, idx, ref.id, ref.groupe)
			assets[ref.id] = a
		}
		if a == nil {
			continue
		}
		mn, mx, ok := boiteDesMaillages(a, lisModelePose(a, ref.groupe, nil).maillages)
		if ok {
			boites = append(boites, [2][3]float64{mn, mx})
		}
	}
	return axesFixes(boites)
}

// axesFixes reports, per axis, whether boxes `boites` all have the same extent there
// (toleranceBoite, toleranceBoiteRel); all false with fewer than two boxes, whose sizes say
// nothing of which axes telescope.
func axesFixes(boites [][2][3]float64) [3]bool {
	var fixes [3]bool
	if len(boites) < 2 {
		return fixes
	}
	for k := range 3 {
		lo, hi := math.Inf(1), math.Inf(-1)
		for _, b := range boites {
			e := b[1][k] - b[0][k]
			lo, hi = math.Min(lo, e), math.Max(hi, e)
		}
		fixes[k] = hi-lo <= math.Max(toleranceBoite, toleranceBoiteRel*hi)
	}
	return fixes
}

// echelleTelescopique returns `o` with its scale left at 1 on axes `fixes` when it is a
// telescoping object; any other object unchanged.
func echelleTelescopique(o mapvar.Object, fixes [3]bool) mapvar.Object {
	if o.ModeForge != mapvar.ModeForgeTelescopique || o.Scale == nil {
		return o
	}
	s := *o.Scale
	if fixes[0] {
		s.X = 1
	}
	if fixes[1] {
		s.Y = 1
	}
	if fixes[2] {
		s.Z = 1
	}
	o.Scale = &s
	return o
}
