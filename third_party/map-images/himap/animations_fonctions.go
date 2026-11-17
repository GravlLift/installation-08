// Package himap — animations_fonctions.go (LOCAL-CHANGE (infinite-theater-3d)): the functions an
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
	membreOffFonctions    = 216
	fonctionEntree        = 16
	fonctionOffImages     = 6
	fonctionOffCourbe     = 12
	sectionFonctions      = 16
	fonctionsVersion      = 1
	fonctionsOffCompte    = 1
	fonctionsOffImages    = 4
	fonctionsOffCourbes   = 8
	courbeFnMarque        = 'S'
	courbeFnOffSegments   = 2
	courbeFnOffOrigine    = 8
	courbeFnOffEtendue    = 12
	courbeFnEntete        = 16
	courbeFnOctetsValeur  = 2
	courbeFnQuantum       = 32767.0
	actionRechargement    = "reload_1"
	niveauActionDesModes  = NiveauxModes - 1
	courbeFnOctetsSegment = 1 + courbeFnOctetsValeur
)

// ErrFonctionsIllisibles: an animation's function list or curves do not read.
var ErrFonctionsIllisibles = errors.New("himap: fonctions d'animation illisibles")

// FonctionAnimation is a function an animation sets: its name (StringID) and its value at each of
// the animation's frames.
type FonctionAnimation struct {
	Nom     uint32
	Valeurs []float64
}

// fonctionsDuMembre returns the function list of member `o` (its offset) of the members block `bloc`.
func fonctionsDuMembre(n *navigateurTag, bloc, o int) []byte {
	for _, l := range n.blocs[bloc] {
		if l.champ == o+membreOffFonctions {
			return n.octets(l.cible)
		}
	}
	return nil
}

// Fonctions reads the functions the animation of rank `rang` sets (none: an empty list).
func (g *GrapheAnimation) Fonctions(rang int) ([]FonctionAnimation, error) {
	if rang < 0 || rang >= len(g.Animations) {
		return nil, fmt.Errorf("%w : animation %d sur %d", ErrFonctionsIllisibles, rang, len(g.Animations))
	}
	a := g.Animations[rang]
	m, ok := g.membres[[2]int{a.Groupe, a.Membre}]
	if !ok || len(m.fonctions) == 0 {
		return nil, nil
	}
	if len(m.fonctions)%fonctionEntree != 0 {
		return nil, fmt.Errorf("%w : liste de %d octets", ErrFonctionsIllisibles, len(m.fonctions))
	}
	sec := sectionsDuMembre(m)[sectionFonctions]
	out := make([]FonctionAnimation, 0, len(m.fonctions)/fonctionEntree)
	for e := 0; e < len(m.fonctions); e += fonctionEntree {
		ent := m.fonctions[e : e+fonctionEntree]
		images := int(binary.LittleEndian.Uint16(ent[fonctionOffImages:]))
		v, err := courbeDeFonction(sec, int(ent[fonctionOffCourbe]), images)
		if err != nil {
			return nil, fmt.Errorf("%w : fonction %08x : %w", ErrFonctionsIllisibles, binary.LittleEndian.Uint32(ent), err)
		}
		out = append(out, FonctionAnimation{Nom: binary.LittleEndian.Uint32(ent), Valeurs: v})
	}
	return out, nil
}

// courbeDeFonction decodes curve `k` of section 16 `sec` over `images` frames.
func courbeDeFonction(sec []byte, k, images int) ([]float64, error) {
	if len(sec) < courbeFnEntete || sec[0] != fonctionsVersion || k >= int(sec[fonctionsOffCompte]) {
		return nil, fmt.Errorf("section de %d octets, courbe %d", len(sec), k)
	}
	tab := int(binary.LittleEndian.Uint32(sec[fonctionsOffCourbes:])) + 4*k
	if tab+4 > len(sec) {
		return nil, fmt.Errorf("table des courbes hors section")
	}
	c := int(binary.LittleEndian.Uint32(sec[tab:]))
	if c+courbeFnEntete > len(sec) || sec[c] != courbeFnMarque {
		return nil, fmt.Errorf("courbe a %d sans sa marque", c)
	}
	segs := int(binary.LittleEndian.Uint16(sec[c+courbeFnOffSegments:]))
	org := float64(math.Float32frombits(binary.LittleEndian.Uint32(sec[c+courbeFnOffOrigine:])))
	ext := float64(math.Float32frombits(binary.LittleEndian.Uint32(sec[c+courbeFnOffEtendue:])))
	fin := c + courbeFnEntete + segs + courbeFnOctetsValeur + segs*courbeFnOctetsSegment
	if fin > len(sec) {
		return nil, fmt.Errorf("courbe de %d segments hors section", segs)
	}
	norm := func(o int) float64 { return float64(int16(binary.LittleEndian.Uint16(sec[o:]))) / courbeFnQuantum }
	cles := make([]int, segs+1)
	for s := 0; s < segs; s++ {
		cles[s+1] = cles[s] + int(sec[c+courbeFnEntete+s])
	}
	if cles[segs] != images-1 {
		return nil, fmt.Errorf("cles jusqu'a l'image %d sur %d images", cles[segs], images)
	}
	out := make([]float64, images)
	o := c + courbeFnEntete + segs
	p1 := []float64{norm(o)}
	out[0] = org + ext*p1[0]
	o += courbeFnOctetsValeur
	for s := 0; s < segs; s++ {
		p2 := []float64{norm(o + 1)}
		m1, m2 := tangentesSegment(sec[o:o+1], p1, p2)
		for f := cles[s] + 1; f <= cles[s+1]; f++ {
			t := float64(f-cles[s]) / float64(cles[s+1]-cles[s])
			out[f] = org + ext*hermite(p1, m1, p2, m2, t)[0]
		}
		p1 = p2
		o += courbeFnOctetsSegment
	}
	return out, nil
}

// FonctionsDuRechargement reads the functions the weapon `weap`'s own graph (its `hlmt`'s, the
// third-person weapon model's) sets through its reload animations: every animation an entry of
// action `reload_1` names, in every mode, each once.
func (a *Arsenal) FonctionsDuRechargement(ctx context.Context, weap uint32) ([]FonctionAnimation, error) {
	raw, err := a.TagArme(weap)
	if err != nil {
		return nil, err
	}
	hlmts := refsInlineDuGroupe(raw, a.geo, "hlmt")
	if len(hlmts) == 0 {
		return nil, nil
	}
	modele, err := a.geo.Extract(hlmts[0])
	if err != nil {
		return nil, err
	}
	if len(refsInlineDuGroupe(modele, a.geo, GroupeGrapheAnimation)) == 0 {
		return nil, nil // a model without a graph (a weapon that does not animate) sets none
	}
	gs, err := a.GraphesDuModele(ctx, hlmts[0])
	if err != nil {
		return nil, err
	}
	action := NomAnimation(actionRechargement)
	var out []FonctionAnimation
	vus := map[[2]uint32]bool{}
	for _, depuis := range gs.Tous() {
		for _, e := range depuis.Entrees {
			if e.Etiquettes[niveauActionDesModes] != action {
				continue
			}
			g, rang, err := gs.Resout(depuis, e)
			if err != nil {
				return nil, err
			}
			if vus[[2]uint32{g.ID, uint32(rang)}] {
				continue
			}
			vus[[2]uint32{g.ID, uint32(rang)}] = true
			fs, err := g.Fonctions(rang)
			if err != nil {
				return nil, err
			}
			out = append(out, fs...)
		}
	}
	return out, nil
}
