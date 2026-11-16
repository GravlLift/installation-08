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
// The stored scale multiplies the type's reference dimensions, not its model (telescopage).
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

// telescopage (LOCAL-CHANGE (infinite-theater-3d)): how a telescoping type turns an object's
// stored scale into the size of the model the layer draws.
//
// SIZE. The `.mvar` scale multiplies the type's REFERENCE dimensions, the three floats at
// +0xE4 of its `food` root (after the default, minimum and maximum scales at +0xC0, +0xCC,
// +0xD8), not the extent of the model drawn in its place: the game stretches the size it picks
// to reference x scale. Most types' reference is their default model's box; not all of them.
// MEASURED (Outlook, fo13_frost): type -1722685555 (I-beam, sizes 4x8x4 to 8x32x8) has a
// reference of 0.20 x 0.20 x 0.40 against a 0.40 x 0.40 x 0.80 default model, and the trims of
// type -1593549433 have 0.20 x 0.40 x 0.80 against 0.20 x 0.60 x 0.80. Scaling the model
// instead drew the I-beams twice as long as the game: 8.4 m beams ran 5.9 m out of a base's
// front and along its floor (5 264 player feet samples inside them; with the reference and the
// centre rule below, 12), and the trims' height stood 0.23 m above the floor (1 556 feet samples
// inside, 0 with the reference, and the trims hold 4.7 times more standing samples).
//
// PIVOT. On an axis where the reference resizes the model (rapportDifferent), the stretched
// size is centred where the model's box is centred; on the others the scale applies about the
// model's origin, as for any object. MEASURED (Outlook): an I-beam's origin is one end of its
// model (Z from 0); scaled about it, a beam still ran 1.7 m out of a base's front, through a
// player falling at x -21.5 (replay slot 678), and mirrored pairs (objects 1274 and 1276,
// 5085/5089, 5084/5081) pointed opposite ways; about the centre each pair is symmetric and
// spans the base's front between its inner wall and its edge (feet samples inside 1 481 -> 12).
// The door frames (690293631, reference = model) keep their origin: centred, their lintels
// came down 0.77 m onto players walking through them (0 -> 6 torso samples inside).
//
// A type that telescopes on EVERY axis (its sizes differ on all three, `libre`) is a free
// primitive, and its stretch is centred on every axis, the reference resizing the model or not.
// MEASURED (TestVariantSolidsHoldNoPlayers, internal/meshbuild, 15 stored matches, player
// positions inside placed solids by more than 0.1 m, feet + torso): Origin's 13 cylinders on
// its pads (type 1720205523, sizes 2x2x2 to 32x32x24, reference = model 0.2 m, origin at the
// foot; match 27de812c) held 990 samples from the foot, 0 centred. Centred, each pad is a
// three-tier stack whose tiers are where players stand: at (16, 0) the top tier (#5142, 0.6 m
// radius) ends at 62.29 against the feet within 0.6 m at 62.30 (163 of 181 samples), and the
// bottom tier (#5152, 1.45 m) at 61.64 against the feet 1.02 to 1.45 m out at 61.65; at
// (8.19, 8.33) the top tier (#5147) ends at 60.89 (feet 60.90) and the bottom one (#280) at
// 60.22 (feet 1.02 to 1.45 m out at 60.25); at (0, -1.57) #5146 ends at 58.74 (feet 58.75).
// From the foot the tiers rose 0.5 m through the pads. Outlook's two floor blocks of type
// -906033151 (05dfe4e9) held 1 858 samples, 0 centred: block 1634 then ends at 98.40, level
// with the top of cylinder 1669 at its centre, where 2 232 feet samples stand (from the foot it
// ended at 98.58). Origin's blocks (106177700) 2, 0 centred; Solitude's 59 cylinders 18, 11
// centred. A type with a fixed axis keeps the rule above: centring the door frames on every
// axis is the 0 -> 6 above (5 in this test), and the one other such type that moved, Origin's
// slabs (-1170643676, fixed thickness), went from 4 samples to 0, too few to decide.
type telescopage struct {
	// fixes: the model axes the type does not stretch (axesFixes).
	fixes [3]bool
	// libre: the type's sizes differ on every axis (at least two sizes read, no fixed axis); its
	// stretch is centred on every axis.
	libre bool
	// rapport: per model axis, reference dimension / model extent (1 when unknown).
	rapport [3]float64
	// centre: the centre of the model's box, in the frame the layer scales (model + origine).
	centre [3]float64
}

// toleranceRapport: a reference within this fraction of the model's extent does not resize it.
const toleranceRapport = 0.05

// rapportDifferent reports whether reference ratio r resizes the model (rapportsReference).
func rapportDifferent(r float64) bool {
	return r != 0 && math.Abs(r-1) > toleranceRapport
}

// Root layout of a `food` tag (dimensionsReference): default, minimum and maximum scale, then
// the reference dimensions.
const (
	foodRacineEchelle    = 0xC0
	foodRacineReference  = 0xE4
	foodRacineTailleMini = 0xF0
)

// dimensionsReference returns the reference dimensions of the Forge definition `food`; false
// when its root does not carry a unit default scale followed by positive dimensions.
func dimensionsReference(food []byte) ([3]float64, bool) {
	for _, ti := range tagCandidates(food) {
		rb, err := ti.rootBlockIndex()
		if err != nil {
			continue
		}
		start, size := ti.blockAbs(rb)
		if start < 0 || size < foodRacineTailleMini || start+foodRacineTailleMini > len(food) {
			continue
		}
		var dims [3]float64
		for a := range 3 {
			if math.Abs(f32(food, start+foodRacineEchelle+4*a)-1) > 1e-3 {
				return dims, false
			}
			dims[a] = f32(food, start+foodRacineReference+4*a)
			if !(dims[a] > 0) || dims[a] > 1e4 {
				return dims, false
			}
		}
		return dims, true
	}
	return [3]float64{}, false
}

// rapportsReference returns, per axis, reference / model extent for model box (mn, mx); 1 on an
// axis without a usable ratio (reference unread, flat model, ratio outside [0.1, 10]).
func rapportsReference(ref [3]float64, lu bool, mn, mx [3]float64) [3]float64 {
	out := [3]float64{1, 1, 1}
	if !lu {
		return out
	}
	for a := range 3 {
		if e := mx[a] - mn[a]; e > 1e-6 {
			if r := ref[a] / e; r >= 0.1 && r <= 10 {
				out[a] = r
			}
		}
	}
	return out
}

// telescopageDuFood reads how the type of Forge definition `food` telescopes, its default model
// drawing meshes `maillages` of `a`.
func telescopageDuFood(ctx context.Context, idx *ModuleIndex, food []byte, assets map[uint32]*RuntimeGeoAsset, a *RuntimeGeoAsset, maillages []int) telescopage {
	fixes, tailles := axesFixesDuFood(ctx, idx, food, assets)
	t := telescopage{fixes: fixes, libre: estLibre(fixes, tailles), rapport: [3]float64{1, 1, 1}}
	mn, mx, ok := boiteDesMaillages(a, maillages)
	if !ok {
		return t
	}
	ref, lu := dimensionsReference(food)
	t.rapport = rapportsReference(ref, lu, mn, mx)
	for k := range 3 {
		t.centre[k] = (mn[k] + mx[k]) / 2
	}
	return t
}

// estLibre reports whether a type whose `tailles` sizes were read with fixed axes `fixes`
// telescopes on every axis (telescopage.libre); fewer than two sizes say nothing.
func estLibre(fixes [3]bool, tailles int) bool {
	return tailles >= 2 && !fixes[0] && !fixes[1] && !fixes[2]
}

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
// (the models of its representations) all have the same extent there (axesFixes), and how many
// sizes it read.
func axesFixesDuFood(ctx context.Context, idx *ModuleIndex, food []byte, assets map[uint32]*RuntimeGeoAsset) ([3]bool, int) {
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
	return axesFixes(boites), len(boites)
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

// echelleTelescopique returns a telescoping object `o` with the scale its model is drawn at: 1 on
// the axes `t.fixes`, stored x `t.rapport` on the others; and the model-frame offset (to add to
// the model's origin, Instance.decale) that keeps the model's box centre where it is at scale 1
// on the axes the reference resizes (rapportDifferent), or on every stretched axis of a type that
// telescopes on all of them (libre), none on the others. Any other object is returned unchanged,
// with no offset.
func echelleTelescopique(o mapvar.Object, t telescopage) (mapvar.Object, [3]float64) {
	var decalage [3]float64
	if o.ModeForge != mapvar.ModeForgeTelescopique || o.Scale == nil {
		return o, decalage
	}
	stockee := [3]float64{o.Scale.X, o.Scale.Y, o.Scale.Z}
	var e [3]float64
	for a := range 3 {
		e[a] = 1
		if !t.fixes[a] {
			r := t.rapport[a]
			if r == 0 {
				r = 1
			}
			e[a] = stockee[a] * r
		}
		// v' = c + e(v - c) = e(v + c(1-e)/e): the offset is applied before the scale.
		if e[a] != 0 && !t.fixes[a] && (t.libre || rapportDifferent(t.rapport[a])) {
			decalage[a] = t.centre[a] * (1 - e[a]) / e[a]
		}
	}
	o.Scale = &mapvar.Vec3{X: e[0], Y: e[1], Z: e[2]}
	return o, decalage
}
