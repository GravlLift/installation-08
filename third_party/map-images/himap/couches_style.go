// Package himap — couches_style.go : LOCAL-CHANGE (infinite-theater-3d).
//
// Copyright (c) 2026 The Halo Archive (ekur, GPL-3.0-or-later), ported to AGPL-3.0.
//
// Les materiaux dessines par les shaders « Layered » (shader 0xdb8cbebb et famille) ne lient
// aucune carte de couleur : leur apparence vient du bloc style_info du tag `mat `, resolu par
// les tables de style du jeu, comme le fait ekur (material_coating.rs) :
//
//	style_info.material_style (mwsy) -> style par defaut (« default ») -> palette (mwpl)
//	region du materiau -> couche de l'intention de base -> echantillon (mwsw)
//
// Cette couche de base porte la carte de degrade (la vraie couleur de surface) et les couleurs
// du variant choisi ; elle est rendue comme une couche couleur unitaire pour que le materiau
// garde une surface lisible au lieu d'une teinte plate. Les structures viennent de
// ekur_definitions (material.rs, material_styles.rs, material_palette.rs, material_swatch.rs) ;
// leurs FieldBlocks sont des references de bloc (count a +16 de la reference, entrees dans le
// bloc cible) et leurs FieldReferences portent le GlobalID a +8.
package himap

import (
	"encoding/binary"
	"math"
)

// LecteurStyles rend le tag de style (mwsy, mwpl ou mwsw) d'un GlobalID, false quand l'id est
// absent des modules.
type LecteurStyles func(id uint32) (tagInfo, bool)

// lecteurStyles lit chaque tag de style une fois dans les modules de materiaux.
func lecteurStyles(idx *ModuleIndex) LecteurStyles {
	type cache struct {
		ti tagInfo
		ok bool
	}
	lus := map[uint32]cache{}
	return func(id uint32) (tagInfo, bool) {
		if c, deja := lus[id]; deja {
			return c.ti, c.ok
		}
		var c cache
		if g, _, ok := idx.Lookup(id); ok && (g == "mwsy" || g == "mwpl" || g == "mwsw") {
			if tag, err := idx.Extract(id); err == nil {
				for _, ti := range tagCandidates(tag) {
					if _, _, err := ti.rootBlockRefs(); err == nil {
						c = cache{ti: ti, ok: true}
						break
					}
				}
			}
		}
		lus[id] = c
		return c.ti, c.ok
	}
}

// Bloc style_info du tag `mat ` (root 0x88, ekur MaterialTag) : FieldBlock a 0x74 du root,
// une entree de 0x5C.
const (
	styleOffRef       = 0x74
	styleTaille       = 0x5C
	styleOffStyle     = 0x08 // stylelist (mwsy), GlobalID du FieldReference a +0x08
	styleOffRegion    = 0x38
	styleOffIntention = 0x3C
	// styleDefaut : le nom de la region « default » (ekur DEFAULT_STYLE_NAME).
	styleDefaut = 1120495519
)

// mwsy (ekur MaterialStylesTag, root 0xB0).
const (
	mwsyOffRegions    = 0x10 // FieldBlock MaterialRegion (0x18)
	mwsyOffStyles     = 0x50 // FieldBlock MaterialStyle (0x5C)
	mwsyTailleStyle   = 0x5C
	mwsyOffPalette    = 0x0C // FieldReference a +0x04, GlobalID a +8
	mwsyOffRegionsS   = 0x3C // FieldBlock MaterialStyleRegion (0x28)
	mwsyTailleRegion  = 0x18
	mwsyOffIntentions = 0x04 // FieldBlock IntentionConversionElement (4 o)
	mwsyTailleStyleR  = 0x28
	mwsyOffCouches    = 0x08 // FieldBlock MaterialLayer (0x48)
	mwsyTailleCouche  = 0x48
	mwsyOffNomCouche  = 0x08
)

// mwpl (ekur MaterialPaletteTag, root 0x28).
const (
	mwplOffSwatches  = 0x10 // FieldBlock MaterialSwatchEntry (0x38)
	mwplTailleSwatch = 0x38
	mwplOffSwatch    = 0x0C // FieldReference a +0x04, GlobalID a +8
	mwplOffCouleur   = 0x20
)

// mwsw (ekur MaterialSwatchTag, root 0xA8).
const (
	mwswOffDegrade  = 0x28 // FieldReference a +0x20, GlobalID a +8
	mwswOffNormale  = 0x4C // FieldReference a +0x44, GlobalID a +8 (0 : aucune)
	mwswOffRugW     = 0x3C
	mwswOffRugN     = 0x40
	mwswOffMetal    = 0x60
	mwswOffVariants = 0x94 // FieldBlock MaterialColorVariant (0x30)
	mwswTailleVar   = 0x30
	mwswOffHaut     = 0x04
	mwswOffMilieu   = 0x10
	mwswOffBas      = 0x1C
)

// blocRacine rend les entrees d'un FieldBlock declare a off de la racine de ti ; le count vit
// a +16 de la reference (tagBlockCountOffset).
func blocRacine(ti tagInfo, off, stride int) (abs, n, cible int, ok bool) {
	rb, err := ti.rootBlockIndex()
	if err != nil {
		return 0, 0, 0, false
	}
	rAbs, rSize := ti.blockAbs(rb)
	if rAbs < 0 || off+tagBlockCountOffset+4 > rSize {
		return 0, 0, 0, false
	}
	offs, targets, err := ti.rootBlockRefs()
	if err != nil {
		return 0, 0, 0, false
	}
	for i, o := range offs {
		if o != off {
			continue
		}
		n = u32(ti.tag, rAbs+off+tagBlockCountOffset)
		a, s := ti.blockAbs(targets[i])
		if a < 0 || n == 0 || s != n*stride || a+s > len(ti.tag) {
			return 0, 0, 0, false
		}
		return a, n, targets[i], true
	}
	return 0, 0, 0, false
}

// blocEmboite rend les entrees d'un FieldBlock a champ dans l'entree de parent (bloc dont le
// debut est parentAbs) ; son index de bloc vient de la table des structures (sousBlocsParOffset,
// cles relatives au debut du bloc parent).
func blocEmboite(ti tagInfo, parent, parentAbs, rec, champ, stride int) (abs, n, cible int, ok bool) {
	if rec+champ+tagBlockCountOffset+4 > len(ti.tag) {
		return 0, 0, 0, false
	}
	nCount := u32(ti.tag, rec+champ+tagBlockCountOffset)
	if nCount == 0 {
		return 0, 0, 0, false
	}
	bloc, ok := ti.sousBlocsParOffset(parent)[rec-parentAbs+champ]
	if !ok {
		return 0, 0, 0, false
	}
	a, s := ti.blockAbs(bloc)
	if a < 0 || s != nCount*stride || a+s > len(ti.tag) {
		return 0, 0, 0, false
	}
	return a, nCount, bloc, true
}

// couchesStyle lit les entrees style_info du bloc (abs, size) du tag de materiau et resolut la
// couche de base ; nil quand le materiau ne porte pas de style lisible. rAbs est le debut du
// bloc racine du materiau (le count du style_info y est, a styleOffRef+16).
func couchesStyle(ti tagInfo, rAbs, abs, size int, styles LecteurStyles) *Couches {
	n := u32(ti.tag, rAbs+styleOffRef+tagBlockCountOffset)
	if n == 0 || size != n*styleTaille || abs+size > len(ti.tag) {
		return nil
	}
	e := abs
	sid := uint32(u32(ti.tag, e+styleOffStyle))
	region := uint32(u32(ti.tag, e+styleOffRegion))
	base := uint32(u32(ti.tag, e+styleOffIntention))
	if sid == 0 {
		return nil
	}
	mt, ok := styles(sid)
	if !ok {
		return nil
	}
	so, nS, cibleS, ok := blocRacine(mt, mwsyOffStyles, mwsyTailleStyle)
	if !ok {
		return nil
	}
	// Le style du stylelist : « default » par le nom, sinon le premier (ekur).
	i0 := 0
	for i := 0; i < nS; i++ {
		if uint32(u32(mt.tag, so+i*mwsyTailleStyle)) == styleDefaut {
			i0 = i
			break
		}
	}
	st := so + i0*mwsyTailleStyle
	palette := uint32(u32(mt.tag, st+mwsyOffPalette))
	// La region du materiau dans le style, sinon la premiere.
	ro, nR, cibleR, ok := blocEmboite(mt, cibleS, so, st, mwsyOffRegionsS, mwsyTailleStyleR)
	if !ok {
		return nil
	}
	ri := 0
	for i := 0; i < nR; i++ {
		if uint32(u32(mt.tag, ro+i*mwsyTailleStyleR)) == region {
			ri = i
			break
		}
	}
	re := ro + ri*mwsyTailleStyleR
	lo, nL, _, ok := blocEmboite(mt, cibleR, ro, re, mwsyOffCouches, mwsyTailleCouche)
	if !ok {
		return nil
	}
	// Les noms d'intention de la region (mwsy.regions), quand la region y est.
	io, ni := 0, 0
	if qo, nQ, cibleQ, ok := blocRacine(mt, mwsyOffRegions, mwsyTailleRegion); ok {
		for i := 0; i < nQ; i++ {
			qe := qo + i*mwsyTailleRegion
			if uint32(u32(mt.tag, qe)) == region {
				io, ni, _, _ = blocEmboite(mt, cibleQ, qo, qe, mwsyOffIntentions, 4)
				break
			}
		}
	}
	// La couche de l'intention de base (nom converti par la liste, sinon le nom brut), sinon
	// la premiere couche.
	i2 := 0
	for i := 0; i < nL; i++ {
		nom := uint32(u32(mt.tag, lo+i*mwsyTailleCouche+mwsyOffNomCouche))
		if i < ni {
			nom = uint32(u32(mt.tag, io+i*4))
		}
		if nom == base {
			i2 = i
			break
		}
	}
	layerNom := uint32(u32(mt.tag, lo+i2*mwsyTailleCouche+mwsyOffNomCouche))
	// L'echantillon de la palette porte le nom de la couche, pas l'intention (ekur).
	pt, ok := styles(palette)
	if !ok {
		return nil
	}
	po, nP, _, ok := blocRacine(pt, mwplOffSwatches, mwplTailleSwatch)
	if !ok {
		return nil
	}
	var ech, couleur uint32
	for i := 0; i < nP; i++ {
		pe := po + i*mwplTailleSwatch
		if uint32(u32(pt.tag, pe)) == layerNom {
			ech = uint32(u32(pt.tag, pe+mwplOffSwatch))
			couleur = uint32(u32(pt.tag, pe+mwplOffCouleur))
			break
		}
	}
	if ech == 0 {
		return nil
	}
	return coucheEchantillon(styles, ech, couleur)
}

// coucheEchantillon lit le tag mwsw et rend la couche de base : carte de degrade, couleurs du
// variant, normale et matiere ; nil quand l'echantillon est vide ou absent.
func coucheEchantillon(styles LecteurStyles, ech, couleur uint32) *Couches {
	wt, ok := styles(ech)
	if !ok {
		return nil
	}
	rb, err := wt.rootBlockIndex()
	if err != nil {
		return nil
	}
	ra, rs := wt.blockAbs(rb)
	if ra < 0 || rs < 0xA8 || ra+rs > len(wt.tag) {
		return nil
	}
	degrade := uint32(u32(wt.tag, ra+mwswOffDegrade))
	if degrade == 0 {
		return nil
	}
	vo, nV, _, ok := blocRacine(wt, mwswOffVariants, mwswTailleVar)
	if !ok {
		return nil
	}
	i := 0
	for k := 0; k < nV; k++ {
		if uint32(u32(wt.tag, vo+k*mwswTailleVar)) == couleur {
			i = k
			break
		}
	}
	ve := vo + i*mwswTailleVar
	k := Couche{
		Sorte:   CoucheCouleur,
		Bitmap:  degrade,
		Transfo: transfoNeutre,
		Teinte:  [3]float32{1, 1, 1},
		Opacite: 1,
		Haut:    rgb32(wt.tag, ve+mwswOffHaut),
		Milieu:  rgb32(wt.tag, ve+mwswOffMilieu),
		Bas:     rgb32(wt.tag, ve+mwswOffBas),
	}
	if normale := uint32(u32(wt.tag, ra+mwswOffNormale)); normale != 0 {
		k.Normale = normale
		k.TransfoNormale = transfoNeutre
		k.IntensiteNormale = 1
	}
	k.Matiere = &MatiereCouche{
		Blanc: f32limite(wt.tag, ra+mwswOffRugW),
		Noir:  f32limite(wt.tag, ra+mwswOffRugN),
		Metal: f32limite(wt.tag, ra+mwswOffMetal),
	}
	return &Couches{JeuUV: jeuUVDiffus, Couches: []Couche{k}}
}

// rgb32 lit une couleur de trois float32, bornee a [0, 1].
func rgb32(b []byte, o int) [3]float32 {
	var out [3]float32
	for i := range out {
		out[i] = min(max(f32limite(b, o+4*i), 0), 1)
	}
	return out
}

// f32limite lit un float32 ; hors bornes ou non fini, zéro.
func f32limite(b []byte, o int) float32 {
	if o < 0 || o+4 > len(b) {
		return 0
	}
	v := math.Float32frombits(binary.LittleEndian.Uint32(b[o:]))
	if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) {
		return 0
	}
	return v
}
