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
// rule (base on the position). A definition that reaches several `mode`s (one per size) is held
// against the one of the `rtgo`'s size (origineParmi).
package himap

import (
	"context"
	"iter"
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

// origineParmi returns the offset of an `rtgo` box (origineRtgo) against the first of `modes`
// (boxes, in order) that describes the same box; the earlier rule when none does.
//
// A definition can reach several `mode`s: Origin's rock type -1241957150 has one `bloc` per
// size (Small 4.3 m, Medium 21.5 m, Large 34.5 m) and its `rtgo`s are the Medium geometry. Only
// the `mode` of the same geometry places the `rtgo`'s pivot; held against the first one (Small),
// the rock fell back to the base rule and was lifted by half its scaled height, through a base.
func origineParmi(rtgoMin, rtgoMax [3]float64, modes iter.Seq2[[3]float64, [3]float64]) [3]float64 {
	for mmn, mmx := range modes {
		if memeBoite(rtgoMin, rtgoMax, mmn, mmx) {
			return origineRtgo(rtgoMin, rtgoMax, mmn, mmx, true)
		}
	}
	return origineRtgo(rtgoMin, rtgoMax, [3]float64{}, [3]float64{}, false)
}

// origineDuRtgo returns the offset of `rtgo` meshes `maillages` (origineParmi) against the
// candidate `mode`s, read only until one matches.
func origineDuRtgo(rtgo *RuntimeGeoAsset, maillages []int, modes iter.Seq[*modelePose]) [3]float64 {
	rmn, rmx, ok := boiteDesMaillages(rtgo, maillages)
	if !ok {
		return [3]float64{}
	}
	return origineParmi(rmn, rmx, func(yield func([3]float64, [3]float64) bool) {
		for mode := range modes {
			if mmn, mmx, lu := boiteDesMaillages(mode.asset, mode.maillages); lu && !yield(mmn, mmx) {
				return
			}
		}
	})
}

// unMode returns the candidate sequence of one `mode` (none when nil).
func unMode(mode *modelePose) iter.Seq[*modelePose] {
	return func(yield func(*modelePose) bool) {
		if mode != nil {
			yield(mode)
		}
	}
}

// modesDuType returns the render models of the Forge definition `food` (modesDuFood); none when
// the definition is unreadable.
func modesDuType(ctx context.Context, idx *ModuleIndex, forge *himodule.Module, food himodule.File, assets map[uint32]*RuntimeGeoAsset) iter.Seq[*modelePose] {
	tag, err := forge.Extract(food)
	if err != nil {
		return unMode(nil)
	}
	return modesDuFood(ctx, idx, tag, assets, 0)
}

// modesDuFood returns the render models of a Forge definition, in order: the first `mode` each of
// its `bloc`/`scen`/`mach` objects reaches through its `hlmt`, drawn as representation `nom`
// (maillagesDeLaRepresentation; 0: the model's default). Each is opened when the consumer asks
// for it.
func modesDuFood(ctx context.Context, idx *ModuleIndex, food []byte, assets map[uint32]*RuntimeGeoAsset, nom uint32) iter.Seq[*modelePose] {
	return func(yield func(*modelePose) bool) {
		for _, groupe := range groupesSautForge {
			for _, h := range refsTypeesDuGroupe(food, idx, groupe) {
				objet, err := idx.Extract(h)
				if err != nil {
					continue
				}
				if mp := modeDuObjet(ctx, idx, objet, assets, nom); mp != nil && !yield(mp) {
					return
				}
			}
		}
	}
}

// maillagesDeLaRepresentation returns the sections of `mode` tag `tag` that Forge representation
// `nom` draws: those of the permutations named `nom`, else those of the regions named `nom`;
// nil when neither exists (the caller keeps the model's default).
//
// Translated from Ekur's Forge map import (TheHaloArchive, addon/src/operators/
// forge_map_operator.py, ForgeMapOperator.execute; Copyright (c) 2026 The Halo Archive,
// GPL-3.0-or-later): a Forge object draws the sections of its `mode` whose permutation, else
// whose region, carries the object's representation name. A `mode` that serves several
// representations keeps each in its own permutation: Fortress's type -960331706 has a
// 2.29 m default permutation and a 2.20 m "forge" one (528041935), which the `rtgo` of
// representation 528041935 re-centres.
func maillagesDeLaRepresentation(tag []byte, nom uint32) []int {
	if nom == 0 {
		return nil
	}
	regions, err := ModeRegions(tag)
	if err != nil {
		return nil
	}
	return sectionsDeLaRepresentation(regions, nom)
}

// sectionsDeLaRepresentation is maillagesDeLaRepresentation on a `mode`'s regions.
func sectionsDeLaRepresentation(regions []Region, nom uint32) []int {
	var parPermutation, parRegion []int
	for _, r := range regions {
		for _, p := range r.Permutations {
			if p.SectionIndex < 0 {
				continue
			}
			for k := 0; k < p.SectionCount; k++ {
				if p.Name == nom {
					parPermutation = append(parPermutation, p.SectionIndex+k)
				}
				if r.Name == nom {
					parRegion = append(parRegion, p.SectionIndex+k)
				}
			}
		}
	}
	if len(parPermutation) > 0 {
		return parPermutation
	}
	return parRegion
}

// modeDuObjet returns the first `mode` the `hlmt` models of an object tag reference, drawn as
// representation `nom` (maillagesDeLaRepresentation); nil without.
func modeDuObjet(ctx context.Context, idx *ModuleIndex, objet []byte, assets map[uint32]*RuntimeGeoAsset, nom uint32) *modelePose {
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
				if s := maillagesDeLaRepresentation(a.info.tag, nom); s != nil {
					mp.maillages = s
				}
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
