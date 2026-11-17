// Package himap — animation_functions.go (LOCAL-CHANGE (infinite-theater-3d)): the functions an
// animation sets (`animation_event_function_*`, the weapon functions' imports of that name), and the
// ones a weapon's own graph sets through its reloads.
//
// A member of a resource group (animations.go) lists its functions in the block at +216, 16 bytes
// an entry: name StringID u32 +0, frame count u16 +6, curve index u8 +12. Their curves are section
// 16 of the member's blob:
//
//	header : version u8 +0 (1), count u8 +1, offset u32 +4 of the frame counts (u16 a function),
//	         offset u32 +8 of the curve offsets (u32 a function, from the section's start)
//	curve  : mark u8 +0 ('S'), segments u16 +2, u32 +4 (0, not read), origin f32 +8, extent f32
//	         +12, then one u8 gap per segment between its keys (the first key is frame 0, the gaps
//	         sum to the last frame), the first key's value, then per segment one tangent byte and
//	         the next key's value; a value is i16, origin + extent x (i16 / 32767)
//
// The tangent byte and the Hermite segment are the codec 10's (animations_courbes.go), on the
// normalized values. Measured on the Heatwave's and the Cindershot's third-person weapon graphs
// (0fca8aee, 2d6a41e6) and on other graphs' IK weights, whose keys (origin 0.5, extent 1.02, i16
// +-16062) decode to exactly 0 and 1.
package himap

import (
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// Grammar of the function list and its curves.
const (
	memberOffFunctions  = 216
	functionEntrySize   = 16
	functionOffFrames   = 6
	functionOffCurve    = 12
	functionsSection    = 16
	functionsVersion    = 1
	functionsOffCount   = 1
	functionsOffCurves  = 8
	fnCurveMark         = 'S'
	fnCurveOffSegments  = 2
	fnCurveOffOrigin    = 8
	fnCurveOffExtent    = 12
	fnCurveHeader       = 16
	fnCurveValueBytes   = 2
	fnCurveQuantum      = 32767.0
	reloadAction        = "reload_1"
	modeActionLevel     = NiveauxModes - 1
	fnCurveSegmentBytes = 1 + fnCurveValueBytes
)

// ErrUnreadableFunctions: an animation's function list or curves do not read.
var ErrUnreadableFunctions = errors.New("himap: unreadable animation functions")

// AnimationFunction is a function an animation sets: its name (StringID) and its value at each of
// the animation's frames.
type AnimationFunction struct {
	Name   uint32
	Values []float64
}

// memberFunctions returns the function list of member `o` (its offset) of the members block `block`.
func memberFunctions(n *navigateurTag, block, o int) []byte {
	for _, l := range n.blocs[block] {
		if l.champ == o+memberOffFunctions {
			return n.octets(l.cible)
		}
	}
	return nil
}

// Functions reads the functions the animation of rank `rank` sets (none: an empty list).
func (g *GrapheAnimation) Functions(rank int) ([]AnimationFunction, error) {
	if rank < 0 || rank >= len(g.Animations) {
		return nil, fmt.Errorf("%w: animation %d of %d", ErrUnreadableFunctions, rank, len(g.Animations))
	}
	a := g.Animations[rank]
	m, ok := g.membres[[2]int{a.Groupe, a.Membre}]
	if !ok || len(m.functions) == 0 {
		return nil, nil
	}
	if len(m.functions)%functionEntrySize != 0 {
		return nil, fmt.Errorf("%w: a list of %d bytes", ErrUnreadableFunctions, len(m.functions))
	}
	sec := sectionsDuMembre(m)[functionsSection]
	out := make([]AnimationFunction, 0, len(m.functions)/functionEntrySize)
	for e := 0; e < len(m.functions); e += functionEntrySize {
		entry := m.functions[e : e+functionEntrySize]
		frames := int(binary.LittleEndian.Uint16(entry[functionOffFrames:]))
		v, err := functionCurve(sec, int(entry[functionOffCurve]), frames)
		if err != nil {
			return nil, fmt.Errorf("%w: function %08x: %w", ErrUnreadableFunctions, binary.LittleEndian.Uint32(entry), err)
		}
		out = append(out, AnimationFunction{Name: binary.LittleEndian.Uint32(entry), Values: v})
	}
	return out, nil
}

// functionCurve decodes curve `k` of section 16 `sec` over `frames` frames.
func functionCurve(sec []byte, k, frames int) ([]float64, error) {
	if len(sec) < fnCurveHeader || sec[0] != functionsVersion || k >= int(sec[functionsOffCount]) {
		return nil, fmt.Errorf("a section of %d bytes, curve %d", len(sec), k)
	}
	table := int(binary.LittleEndian.Uint32(sec[functionsOffCurves:])) + 4*k
	if table+4 > len(sec) {
		return nil, fmt.Errorf("curve table outside the section")
	}
	c := int(binary.LittleEndian.Uint32(sec[table:]))
	if c+fnCurveHeader > len(sec) || sec[c] != fnCurveMark {
		return nil, fmt.Errorf("curve at %d without its mark", c)
	}
	segs := int(binary.LittleEndian.Uint16(sec[c+fnCurveOffSegments:]))
	org := float64(math.Float32frombits(binary.LittleEndian.Uint32(sec[c+fnCurveOffOrigin:])))
	ext := float64(math.Float32frombits(binary.LittleEndian.Uint32(sec[c+fnCurveOffExtent:])))
	end := c + fnCurveHeader + segs + fnCurveValueBytes + segs*fnCurveSegmentBytes
	if end > len(sec) {
		return nil, fmt.Errorf("a curve of %d segments outside the section", segs)
	}
	norm := func(o int) float64 { return float64(int16(binary.LittleEndian.Uint16(sec[o:]))) / fnCurveQuantum }
	keys := make([]int, segs+1)
	for s := 0; s < segs; s++ {
		keys[s+1] = keys[s] + int(sec[c+fnCurveHeader+s])
	}
	if keys[segs] != frames-1 {
		return nil, fmt.Errorf("keys up to frame %d of %d frames", keys[segs], frames)
	}
	out := make([]float64, frames)
	o := c + fnCurveHeader + segs
	p1 := []float64{norm(o)}
	out[0] = org + ext*p1[0]
	o += fnCurveValueBytes
	for s := 0; s < segs; s++ {
		p2 := []float64{norm(o + 1)}
		m1, m2 := tangentesSegment(sec[o:o+1], p1, p2)
		for f := keys[s] + 1; f <= keys[s+1]; f++ {
			t := float64(f-keys[s]) / float64(keys[s+1]-keys[s])
			out[f] = org + ext*hermite(p1, m1, p2, m2, t)[0]
		}
		p1 = p2
		o += fnCurveSegmentBytes
	}
	return out, nil
}

// ReloadFunctions reads the functions the weapon `weap`'s own graph (its `hlmt`'s, the
// third-person weapon model's) sets through its reload animations: every animation an entry of
// action `reload_1` names, in every mode, each once.
func (a *Arsenal) ReloadFunctions(ctx context.Context, weap uint32) ([]AnimationFunction, error) {
	raw, err := a.TagArme(weap)
	if err != nil {
		return nil, err
	}
	hlmts := refsInlineDuGroupe(raw, a.geo, "hlmt")
	if len(hlmts) == 0 {
		return nil, nil
	}
	model, err := a.geo.Extract(hlmts[0])
	if err != nil {
		return nil, err
	}
	if len(refsInlineDuGroupe(model, a.geo, GroupeGrapheAnimation)) == 0 {
		return nil, nil // a model without a graph (a weapon that does not animate) sets none
	}
	gs, err := a.GraphesDuModele(ctx, hlmts[0])
	if err != nil {
		return nil, err
	}
	action := NomAnimation(reloadAction)
	var out []AnimationFunction
	seen := map[[2]uint32]bool{}
	for _, from := range gs.Tous() {
		for _, e := range from.Entrees {
			if e.Etiquettes[modeActionLevel] != action {
				continue
			}
			g, rank, err := gs.Resout(from, e)
			if err != nil {
				return nil, err
			}
			if seen[[2]uint32{g.ID, uint32(rank)}] {
				continue
			}
			seen[[2]uint32{g.ID, uint32(rank)}] = true
			fs, err := g.Functions(rank)
			if err != nil {
				return nil, err
			}
			out = append(out, fs...)
		}
	}
	return out, nil
}
