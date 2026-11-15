// Package himap — couches_style.go : LOCAL-CHANGE (infinite-theater-3d).
//
// Copyright (c) 2026 The Halo Archive (ekur, GPL-3.0-or-later), ported to AGPL-3.0.
//
// Les materiaux dessines par les shaders « Layered » (shader 0xdb8cbebb et famille) ne lient
// aucune carte de couleur : leur apparence vient du bloc style_info du tag `mat `, resolu par
// les tables de style du jeu, comme le fait ekur (material_coating.rs) :
//
//	style_info.material_style (mwsy) -> style par defaut (« default ») -> palette (mwpl)
//	region du materiau -> couche de chaque intention -> echantillon (mwsw)
//
// Ekur's HIMS shader (addon/src/nodes/hims.py, infinite_masking_sorter.py, infinite_color.py)
// then draws the material from up to seven ZONES and its own textures:
//
//	color = zone 1; zone k = 2..7 laid over it by Mask0 R, G, B then Mask1 R, G, B
//	grime laid last by clamp(ASG.B + grime amount - 1)
//	color x ASG.R (ambient occlusion); the material's own normal map under the zones' detail
//	a base intention among TRANSPARENT_INTENTIONS cuts the surface where the ASG alpha is low
//
// A zone draws its swatch: the gradient map's red is the index into the variant's bottom /
// middle / top colors (layer.py, color_mixer.py), on UV0 scaled by the material's texel density
// times the swatch's transform (better_uv_scaling.py). The viewer composes four layers under one
// mask (glb_couches.go): the build keeps the first zone, then the next enabled zones and grime
// (three at most), and writes their weights into one mask image (MasqueStyle).
//
// Not drawn: scratches (ASG.G), emission, damage and the swatches' own roughness maps. The
// structures come from ekur_definitions (material.rs, material_styles.rs, material_palette.rs,
// material_swatch.rs); their FieldBlocks are block references (count at +16 of the reference,
// entries in the target block) and their FieldReferences carry the GlobalID at +8.
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
	styleOffRef        = 0x74
	styleTaille        = 0x5C
	styleOffStyle      = 0x08 // stylelist (mwsy), GlobalID du FieldReference a +0x08
	styleOffRegion     = 0x38
	styleOffIntention  = 0x3C // base, then Mask0 R, G, B and Mask1 R, G, B (seven string ids)
	styleOffSupportees = 0x58 // MaterialStyleShaderSupportedLayers: 0: 1, 1: 4, 2: 7, 3: none
	zonesMax           = 7
	// styleDefaut : le nom de la region « default » (ekur DEFAULT_STYLE_NAME).
	styleDefaut = 1120495519
	// regionToutes : the style region every material region falls back to (Ekur ANY_REGION).
	regionToutes = 192819851
)

// intentionsTransparentes : base intentions whose zones are cut by the ASG alpha (Ekur
// TRANSPARENT_INTENTIONS, layered_shader.py).
var intentionsTransparentes = map[int32]bool{-783606968: true, -1010104944: true}

// Parametres d'un materiau (ekur MaterialParameter, 0x9C) : FieldBlock a 0x2C du root.
const (
	matOffParametres = 0x2C
	parametreTaille  = 0x9C
	parametreOffBmp  = 0x08 + refOffGlobalID
	parametreOffReel = 0x34
	parametreOffVec  = 0x38
	// Names of the parameters a layered material binds (ekur layered_shader.rs).
	paramNormale = 2142563353
	paramMasque0 = -1869712910
	paramMasque1 = -1677269129
	paramASG     = -447337164
	paramDensite = 523899303
)

// parametresStyle : the textures and texel density a layered Forge material binds.
type parametresStyle struct {
	normale, masque0, masque1, asg uint32
	densite                        [2]float32
}

// litParametresStyle lit le bloc de parametres (abs, size) ; un bitmap absent vaut 0, une
// densite absente (1, 1).
func litParametresStyle(tag []byte, abs, size int) parametresStyle {
	p := parametresStyle{densite: [2]float32{1, 1}}
	if size%parametreTaille != 0 {
		return p
	}
	for e := abs; e+parametreTaille <= abs+size && e+parametreTaille <= len(tag); e += parametreTaille {
		bmp := uint32(u32(tag, e+parametreOffBmp))
		if bmp == 0xffffffff {
			bmp = 0
		}
		switch int32(u32(tag, e)) {
		case paramNormale:
			p.normale = bmp
		case paramMasque0:
			p.masque0 = bmp
		case paramMasque1:
			p.masque1 = bmp
		case paramASG:
			p.asg = bmp
		case paramDensite:
			// Ekur: texel_density = (real, vector.x); the material offset (vector.y, .z) is 0 on
			// every Forge material measured and is not applied.
			if d := [2]float32{f32limite(tag, e+parametreOffReel), f32limite(tag, e+parametreOffVec)}; d[0] > 0 && d[1] > 0 {
				p.densite = d
			}
		}
	}
	return p
}

// mwsy (ekur MaterialStylesTag, root 0xB0).
const (
	mwsyOffRegions    = 0x10 // FieldBlock MaterialRegion (0x18)
	mwsyOffStyles     = 0x50 // FieldBlock MaterialStyle (0x5C)
	mwsyTailleStyle   = 0x5C
	mwsyOffPalette    = 0x0C // FieldReference a +0x04, GlobalID a +8
	mwsyOffSalete     = 0x34 // grime_type (string id), grime_amount a +0x38
	mwsyOffQuantite   = 0x38
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
	mwswOffTransfo  = 0x10 // color_and_roughness_texture_transform (2 floats)
	mwswOffTransfoN = 0x18 // normal_texture_transform (2 floats)
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
	// The empty swatch's maps (ekur DEFAULT_GRADIENT, DEFAULT_NORMAL): a swatch with both draws
	// nothing (CommonLayer.disabled).
	degradeVide = 15173
	normaleVide = 10070
)

// SourcePoids : where a layer's weight comes from in a Forge style material's textures.
type SourcePoids uint8

const (
	poidsAucun SourcePoids = iota
	poidsMasque0R
	poidsMasque0V
	poidsMasque0B
	poidsMasque1R
	poidsMasque1V
	poidsMasque1B
	// poidsSalete : clamp(ASG.B + Salete - 1), the grime of infinite_masking_sorter.py.
	poidsSalete
)

// MasqueStyle : the mask a Forge style material's layers 2, 3, 4 read (R, G, B), composed from
// its Mask0, Mask1 and ASG textures (0 : absent), on UV1 like them: Ekur's Forge import makes UV1
// the active map, which the HIMS textures read, while the swatches read UV0
// (forge_map_operator.py, better_uv_scaling.py).
type MasqueStyle struct {
	Masque0, Masque1, ASG uint32
	Canaux                [3]SourcePoids
	Salete                float32
	// Decoupe : the mask's alpha is the opacity of a transparent base intention, the ASG's
	// alpha (Decoupe.AlphaSeul): the surface is cut where that alpha is low.
	Decoupe bool
}

// sourceZone : the weight of zone z (0 : base, drawn under the others).
var sourceZone = [zonesMax]SourcePoids{poidsAucun, poidsMasque0R, poidsMasque0V, poidsMasque0B, poidsMasque1R, poidsMasque1V, poidsMasque1B}

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

// coucheRegion : a style region's layer, its palette name and its rank in the region.
type coucheRegion struct {
	nom  uint32
	rang int
}

// regionStyle : a style region's layers by intention (the region's conversion list names layer
// i; without it, the layer's own name), and its layer count.
type regionStyle struct {
	parIntention map[uint32]coucheRegion
	n            int
}

// styleResolu : the style a material draws: its palette, regions and grime.
type styleResolu struct {
	palette        tagInfo
	regions        map[uint32]regionStyle
	salete         uint32
	quantiteSalete float32
}

// resoutStyle lit le style par defaut du stylelist sid (« default » par le nom, sinon le
// premier, comme ekur).
func resoutStyle(sid uint32, styles LecteurStyles) (styleResolu, bool) {
	var r styleResolu
	mt, ok := styles(sid)
	if !ok {
		return r, false
	}
	so, nS, cibleS, ok := blocRacine(mt, mwsyOffStyles, mwsyTailleStyle)
	if !ok {
		return r, false
	}
	i0 := 0
	for i := 0; i < nS; i++ {
		if uint32(u32(mt.tag, so+i*mwsyTailleStyle)) == styleDefaut {
			i0 = i
			break
		}
	}
	st := so + i0*mwsyTailleStyle
	if r.palette, ok = styles(uint32(u32(mt.tag, st+mwsyOffPalette))); !ok {
		return r, false
	}
	r.salete = uint32(u32(mt.tag, st+mwsyOffSalete))
	r.quantiteSalete = f32limite(mt.tag, st+mwsyOffQuantite)
	conversions := map[uint32][]uint32{}
	if qo, nQ, cibleQ, ok := blocRacine(mt, mwsyOffRegions, mwsyTailleRegion); ok {
		for i := 0; i < nQ; i++ {
			qe := qo + i*mwsyTailleRegion
			io, ni, _, _ := blocEmboite(mt, cibleQ, qo, qe, mwsyOffIntentions, 4)
			for k := 0; k < ni; k++ {
				conversions[uint32(u32(mt.tag, qe))] = append(conversions[uint32(u32(mt.tag, qe))], uint32(u32(mt.tag, io+k*4)))
			}
		}
	}
	r.regions = map[uint32]regionStyle{}
	ro, nR, cibleR, ok := blocEmboite(mt, cibleS, so, st, mwsyOffRegionsS, mwsyTailleStyleR)
	if !ok {
		return r, true
	}
	for i := 0; i < nR; i++ {
		re := ro + i*mwsyTailleStyleR
		nom := uint32(u32(mt.tag, re))
		reg := regionStyle{parIntention: map[uint32]coucheRegion{}}
		if lo, nL, _, ok := blocEmboite(mt, cibleR, ro, re, mwsyOffCouches, mwsyTailleCouche); ok {
			reg.n = nL
			conv := conversions[nom]
			for l := 0; l < nL; l++ {
				c := coucheRegion{nom: uint32(u32(mt.tag, lo+l*mwsyTailleCouche+mwsyOffNomCouche)), rang: l}
				cle := c.nom
				if l < len(conv) {
					cle = conv[l]
				}
				reg.parIntention[cle] = c
			}
		}
		r.regions[nom] = reg
	}
	return r, true
}

// zone rend la couche de region qui peint l'intention de la zone z (ekur get_intention) : celle
// de la region du materiau, sinon de la region commune ; sinon, les styles de materiau etant de
// l'« ancien systeme » d'ekur (reference `{id}_{nom}`), la couche de meme rang de la region du
// materiau. Les intentions globales (cogl 680672300) n'y ajoutent rien : MEASURED (fo09_academy),
// la base et les six intentions de masque y pointent l'echantillon vide (degradeVide,
// normaleVide), qu'ekur desactive.
func (r styleResolu) zone(region uint32, intention uint32, z int) (coucheRegion, bool) {
	reg, aRegion := r.regions[region]
	if c, ok := reg.parIntention[intention]; aRegion && ok {
		return c, true
	}
	if c, ok := r.regions[regionToutes].parIntention[intention]; ok {
		return c, true
	}
	if aRegion {
		for _, c := range reg.parIntention {
			if c.rang == z {
				return c, true
			}
		}
	}
	return coucheRegion{}, false
}

// echantillon rend l'entree de palette nommee nom : son echantillon et sa couleur.
func (r styleResolu) echantillon(nom uint32) (ech, couleur uint32, ok bool) {
	po, nP, _, ok := blocRacine(r.palette, mwplOffSwatches, mwplTailleSwatch)
	if !ok {
		return 0, 0, false
	}
	for i := 0; i < nP; i++ {
		pe := po + i*mwplTailleSwatch
		if uint32(u32(r.palette.tag, pe)) == nom {
			return uint32(u32(r.palette.tag, pe+mwplOffSwatch)), uint32(u32(r.palette.tag, pe+mwplOffCouleur)), true
		}
	}
	return 0, 0, false
}

// couchesStyle lit l'entree style_info du bloc (abs, size) du tag de materiau et rend ses
// couches (nil quand le materiau ne porte pas de style lisible ou aucune zone allumee), pour
// une base transparente sur un ASG sa decoupe, et ses zones (nil sans style lisible). rAbs est le debut du bloc racine du materiau
// (le count du style_info y est, a styleOffRef+16).
func couchesStyle(ti tagInfo, rAbs, abs, size int, styles LecteurStyles, p parametresStyle) (*Couches, *Decoupe, *ZonesStyle) {
	n := u32(ti.tag, rAbs+styleOffRef+tagBlockCountOffset)
	if n == 0 || size != n*styleTaille || abs+size > len(ti.tag) {
		return nil, nil, nil
	}
	e := abs
	sid := uint32(u32(ti.tag, e+styleOffStyle))
	region := uint32(u32(ti.tag, e+styleOffRegion))
	if sid == 0 {
		return nil, nil, nil
	}
	nZones := map[byte]int{0: 1, 1: 4, 2: 7}[ti.tag[e+styleOffSupportees]]
	if nZones == 0 {
		return nil, nil, nil
	}
	st, ok := resoutStyle(sid, styles)
	if !ok {
		return nil, nil, nil
	}
	// Ekur: a region with more layers than the shader supports draws as many zones as it has.
	if reg, ok := st.regions[region]; ok && reg.n > nZones {
		nZones = min(reg.n, zonesMax)
	}
	zs := &ZonesStyle{params: p}
	for z := 0; z < nZones; z++ {
		src := sourceZone[z]
		if (src >= poidsMasque0R && src <= poidsMasque0B && p.masque0 == 0) || (src >= poidsMasque1R && src <= poidsMasque1B && p.masque1 == 0) {
			continue // no mask texture: the zone's weight is 0, whatever paints it
		}
		zn := zoneStyle{numero: z, source: src}
		if c, ok := st.zone(region, uint32(u32(ti.tag, e+styleOffIntention+4*z)), z); ok {
			if ech, couleur, ok := st.echantillon(c.nom); ok {
				if k, ok := echantillonBrut(styles, ech, couleur); ok {
					zn.k = &k
				}
			}
		}
		zs.zones = append(zs.zones, zn)
	}
	if st.quantiteSalete > 0 {
		if ech, couleur, ok := st.echantillon(st.salete); ok {
			if k, ok := echantillonBrut(styles, ech, couleur); ok {
				zs.salete, zs.quantiteSalete = &k, st.quantiteSalete
			}
		}
	}
	var d *Decoupe
	if intentionsTransparentes[int32(u32(ti.tag, e+styleOffIntention))] && p.asg != 0 {
		zs.decoupe = true
	}
	c := zs.couches(nil)
	if zs.decoupe && c != nil { // the cut is drawn by the layers' composed mask only
		d = &Decoupe{Bitmap: p.asg, Echelle: [2]float32{1, 1}, Puissance: 1, Seuil: 0.5, AlphaSeul: true}
	}
	return c, d, zs
}

// ZonesStyle : a Forge style material's zones as its style paints them (zoneStyle), its grime,
// and the textures it lays them with. An object's own Forge style (StyleForge) repaints them.
type ZonesStyle struct {
	zones          []zoneStyle
	salete         *Couche
	quantiteSalete float32
	params         parametresStyle
	// decoupe : the material is cut by its ASG's alpha, which the composed mask carries.
	decoupe bool
}

// zoneStyle : zone `numero` (0: base), the swatch its style paints (nil: off) and its weight.
type zoneStyle struct {
	numero int
	k      *Couche
	source SourcePoids
}

// couches emits the layers the zones draw, repainted by s (nil: the material's own style): the
// first zone lit covers the surface; the next ones, then the grime, are laid over it by the mask,
// three at most (the viewer composes four layers). nil when no zone is lit.
func (zs *ZonesStyle) couches(s *StyleForge) *Couches {
	type allumee struct {
		k      Couche
		source SourcePoids
	}
	var lues []allumee
	for _, z := range zs.zones {
		k := z.k
		if s != nil && z.numero < len(s.Zones) && s.Zones[z.numero] != nil {
			k = s.Zones[z.numero]
		}
		if k != nil {
			lues = append(lues, allumee{zs.params.adapte(*k), z.source})
		}
	}
	salete, quantite := zs.salete, zs.quantiteSalete
	if s != nil {
		salete, quantite = s.Salete, s.QuantiteSalete
	}
	if salete != nil && quantite > 0 && zs.params.asg != 0 {
		lues = append(lues, allumee{zs.params.adapte(*salete), poidsSalete})
	}
	if len(lues) == 0 {
		return nil
	}
	c := &Couches{JeuUV: jeuUVDiffus}
	ms := MasqueStyle{Masque0: zs.params.masque0, Masque1: zs.params.masque1, ASG: zs.params.asg, Salete: quantite}
	for i, z := range lues[:min(len(lues), 4)] {
		k := z.k
		if i > 0 {
			ms.Canaux[i-1] = z.source
			k.Rang = i
		}
		c.Couches = append(c.Couches, k)
	}
	if len(c.Couches) > 1 || zs.decoupe {
		c.Style = &ms
	}
	return c
}

// adapte lays a swatch's layer on the material: its maps scaled by the texel density, the
// material's own normal map (on UV1, unscaled) in place of the swatch's detail normal (it carries
// the object's shape, the courses of a brick wall), and the ASG's ambient occlusion (hims.py
// multiplies the color by its red).
func (p parametresStyle) adapte(k Couche) Couche {
	for i := range 2 {
		k.Transfo.Echelle[i] *= p.densite[i]
		k.TransfoNormale.Echelle[i] *= p.densite[i]
	}
	if p.normale != 0 {
		k.Normale, k.TransfoNormale, k.NormaleObjet = p.normale, transfoNeutre, true
	}
	if k.Normale != 0 {
		k.IntensiteNormale = 1
	}
	if p.asg != 0 {
		k.Controle, k.TransfoControle, k.ControleASG = p.asg, transfoNeutre, true
	}
	return k
}

// echantillonBrut lit le tag mwsw et rend la couche d'une zone, avant le materiau (adapte) :
// carte de degrade et sa transformation, couleurs du variant `couleur`, normale de detail,
// matiere ; false quand ekur l'eteint (variant absent, echantillon vide) ou que l'echantillon est
// illisible.
func echantillonBrut(styles LecteurStyles, ech, couleur uint32) (Couche, bool) {
	wt, ok := styles(ech)
	if !ok {
		return Couche{}, false
	}
	rb, err := wt.rootBlockIndex()
	if err != nil {
		return Couche{}, false
	}
	ra, rs := wt.blockAbs(rb)
	if ra < 0 || rs < 0xA8 || ra+rs > len(wt.tag) {
		return Couche{}, false
	}
	degrade := uint32(u32(wt.tag, ra+mwswOffDegrade))
	normale := uint32(u32(wt.tag, ra+mwswOffNormale))
	if degrade == 0 || (degrade == degradeVide && normale == normaleVide) {
		return Couche{}, false
	}
	vo, nV, _, ok := blocRacine(wt, mwswOffVariants, mwswTailleVar)
	if !ok {
		return Couche{}, false
	}
	ve := -1
	for k := 0; k < nV; k++ {
		if uint32(u32(wt.tag, vo+k*mwswTailleVar)) == couleur {
			ve = vo + k*mwswTailleVar
			break
		}
	}
	if ve < 0 {
		return Couche{}, false // ekur: a palette color the swatch does not carry disables the zone
	}
	// The swatch's gradient map is not a color: its red channel is the index into the variant's
	// bottom / middle / top colors (Ekur, addon/src/nodes/layer.py: Gradient Map -> Separate
	// Color -> R is "Gradient Out", B feeds roughness). Painted as a color map, it drew the
	// map itself (the lime and cyan mottling of every layered Forge surface).
	k := Couche{
		Sorte:       CoucheDegrade,
		IndiceRouge: true,
		Bitmap:      degrade,
		Transfo:     transfoEchantillon(wt.tag, ra+mwswOffTransfo),
		Opacite:     1,
		Haut:        rgb32(wt.tag, ve+mwswOffHaut),
		Milieu:      rgb32(wt.tag, ve+mwswOffMilieu),
		Bas:         rgb32(wt.tag, ve+mwswOffBas),
	}
	if normale != 0 && normale != normaleVide {
		k.Normale, k.TransfoNormale = normale, transfoEchantillon(wt.tag, ra+mwswOffTransfoN)
	}
	k.Matiere = &MatiereCouche{
		Blanc: f32limite(wt.tag, ra+mwswOffRugW),
		Noir:  f32limite(wt.tag, ra+mwswOffRugN),
		Metal: f32limite(wt.tag, ra+mwswOffMetal),
	}
	return k, true
}

// transfoEchantillon : the swatch's transform at o (better_uv_scaling.py scales it by the texel
// density, adapte); a zero component counts as 1.
func transfoEchantillon(b []byte, o int) Transfo {
	t := transfoNeutre
	for i := range 2 {
		if s := f32limite(b, o+4*i); s != 0 {
			t.Echelle[i] = s
		}
	}
	return t
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
