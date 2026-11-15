// Package himap — origine_forge.go (LOCAL-CHANGE (infinite-theater-3d)): where a Forge object's
// `rtgo` model sits relative to the object's position.
//
// A `.mvar` object's position is the ORIGIN of the object's own render model: the `mode` that
// its `bloc`/`scen`/`mach` definition reaches through its `hlmt`. The `rtgo` the variant layer
// draws in its place (the type's default or its Forge representation) is the same geometry
// RE-CENTERED on its own origin. Its vertices are therefore offset by the `mode`'s box corner
// minus the `rtgo`'s: the two boxes have the same size, only their origin differs.
//
// MEASURED (Outlook, fo13_frost): most props have their pivot at a box corner (trim beam
// (-0.30, 0, 0), concrete blocks (-0.10, 0, 0) and (-0.20, 0, 0), angled floor (0, 0, -0.40)),
// terrain rocks and columns at their centre. The earlier rule lifted every `rtgo` by its half
// height: on Outlook it raised the rock columns under the centre platform by half their scaled
// height (up to 10 m), through the floor (14 881 player positions inside them, 0 with this rule).
// A type whose own `mode` is not found, or whose box differs from the `rtgo`'s, keeps the earlier
// rule (base on the position).
package himap

import (
	"context"
	"math"

	"github.com/JGtm/halo-infinite-files-reader/himodule"
)

// toleranceBoite: two boxes describe the same geometry when every side agrees within this
// absolute margin (m) or this fraction of the side.
const (
	toleranceBoite    = 0.02
	toleranceBoiteRel = 0.02
)

// boiteDesMaillages returns the box of meshes `maillages` of `a`, in the model's frame.
func boiteDesMaillages(a *RuntimeGeoAsset, maillages []int) (mn, mx [3]float64, ok bool) {
	for k := range 3 {
		mn[k], mx[k] = math.Inf(1), math.Inf(-1)
	}
	for _, k := range maillages {
		m := a.Mesh(k)
		if m == nil {
			continue
		}
		for _, v := range m.Vertices {
			for c := range 3 {
				mn[c], mx[c] = math.Min(mn[c], v[c]), math.Max(mx[c], v[c])
			}
			ok = true
		}
	}
	return mn, mx, ok
}

// origineRtgo returns the offset added to the `rtgo`'s model-frame vertices to put the object's
// pivot on its position: the corner of the own `mode`'s box (`modeMin`, `modeMax`) minus the
// `rtgo`'s (`rtgoMin`, `rtgoMax`) when both describe the same box; else the earlier rule, the
// `rtgo`'s base on the position.
func origineRtgo(rtgoMin, rtgoMax, modeMin, modeMax [3]float64, modeLu bool) [3]float64 {
	if modeLu && memeBoite(rtgoMin, rtgoMax, modeMin, modeMax) {
		return [3]float64{modeMin[0] - rtgoMin[0], modeMin[1] - rtgoMin[1], modeMin[2] - rtgoMin[2]}
	}
	return [3]float64{0, 0, -rtgoMin[2]}
}

// memeBoite reports whether two boxes have the same sides (toleranceBoite, toleranceBoiteRel).
func memeBoite(amin, amax, bmin, bmax [3]float64) bool {
	for k := range 3 {
		a, b := amax[k]-amin[k], bmax[k]-bmin[k]
		if math.Abs(a-b) > math.Max(toleranceBoite, toleranceBoiteRel*math.Max(a, b)) {
			return false
		}
	}
	return true
}

// origineDuRtgo returns the offset of `rtgo` meshes `maillages` (origineRtgo) against `mode`
// (nil: not found).
func origineDuRtgo(rtgo *RuntimeGeoAsset, maillages []int, mode *modelePose) [3]float64 {
	rmn, rmx, ok := boiteDesMaillages(rtgo, maillages)
	if !ok {
		return [3]float64{}
	}
	var mmn, mmx [3]float64
	lu := false
	if mode != nil {
		mmn, mmx, lu = boiteDesMaillages(mode.asset, mode.maillages)
	}
	return origineRtgo(rmn, rmx, mmn, mmx, lu)
}

// modeDuType returns the own render model of the Forge definition `food` (modeDuFood); nil when
// the definition is unreadable.
func modeDuType(ctx context.Context, idx *ModuleIndex, forge *himodule.Module, food himodule.File, assets map[uint32]*RuntimeGeoAsset) *modelePose {
	tag, err := forge.Extract(food)
	if err != nil {
		return nil
	}
	return modeDuFood(ctx, idx, tag, assets)
}

// modeDuFood returns the own render model of a Forge definition: the first `mode` its
// `bloc`/`scen`/`mach` objects reach through their `hlmt`; nil without one.
func modeDuFood(ctx context.Context, idx *ModuleIndex, food []byte, assets map[uint32]*RuntimeGeoAsset) *modelePose {
	for _, groupe := range groupesSautForge {
		for _, h := range refsTypeesDuGroupe(food, idx, groupe) {
			objet, err := idx.Extract(h)
			if err != nil {
				continue
			}
			if mp := modeDuObjet(ctx, idx, objet, assets); mp != nil {
				return mp
			}
		}
	}
	return nil
}

// modeDuObjet returns the first `mode` the `hlmt` models of an object tag reference; nil without.
func modeDuObjet(ctx context.Context, idx *ModuleIndex, objet []byte, assets map[uint32]*RuntimeGeoAsset) *modelePose {
	for _, hModele := range refsInlineDuGroupe(objet, idx, GroupeHlmt) {
		hlmt, err := idx.Extract(hModele)
		if err != nil {
			continue
		}
		for _, id := range refsInlineDuGroupe(hlmt, idx, GroupeMode) {
			a, deja := assets[id]
			if !deja {
				a = ouvreAsset(ctx, idx, id, GroupeMode)
				assets[id] = a
			}
			if a != nil {
				mp := lisModelePose(a, GroupeMode, nil)
				return &mp
			}
		}
	}
	return nil
}

// decale returns the pose `in` moved so that model-frame point `o` (scaled by the pose) is
// added to every vertex: position + o·scale along forward, left and up.
func (in Instance) decale(o [3]float64) Instance {
	for a := range in.Position {
		in.Position[a] += o[0]*in.Scale[0]*in.Forward[a] + o[1]*in.Scale[1]*in.Left[a] + o[2]*in.Scale[2]*in.Up[a]
	}
	return in
}
