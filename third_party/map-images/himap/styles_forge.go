// Package himap — styles_forge.go (LOCAL-CHANGE (infinite-theater-3d)): an object's own Forge
// material style.
//
// A Forge map gives most of its objects a material of their own (`.mvar` root field 8; Fortress:
// 3 390 of 5 504 objects): up to four layers, the swatches of the material's zones 1 to 4 with a
// tint (mapvar.StyleLayer), and a grime swatch with its amount (mapvar.StyleGrime), as Ekur's
// add-on reads them (forge_level_reader.py, ForgeMat). The swatches are named by hash and
// resolved in the game's own Forge palette (mwpl 0x4FD73754, StylesForgeJeu), then in a
// reference catalog of Ekur layers exported from it (forge_materials.json: gradient and normal
// maps, their transforms, the bottom / middle / top colors) for any the game does not name. The style repaints the zones of the
// object's layered materials (ZonesStyle.couches); a zone it does not name keeps the material's
// own swatch, and its grime replaces the material's style grime.
package himap

import (
	"encoding/json"
	"fmt"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// StyleForge is an object's Forge style: the layers that repaint its materials' zones 1 to 4
// (nil: the material's own) and its grime (nil: none).
type StyleForge struct {
	Zones          [4]*Couche
	Salete         *Couche
	QuantiteSalete float32
}

// coucheCatalogue is an Ekur layer of the Forge material catalog (CommonLayer).
type coucheCatalogue struct {
	Disabled       bool       `json:"disabled"`
	GradientXform  [2]float32 `json:"gradient_transform"`
	NormalXform    [2]float32 `json:"normal_transform"`
	GradientBitmap int32      `json:"gradient_bitmap"`
	NormalBitmap   int32      `json:"normal_bitmap"`
	RoughnessWhite float32    `json:"roughness_white"`
	RoughnessBlack float32    `json:"roughness_black"`
	Metallic       float32    `json:"metallic"`
	TopJSON        []float32  `json:"top_color"`
	MidJSON        []float32  `json:"mid_color"`
	BotJSON        []float32  `json:"bot_color"`
}

// paletteForge : the game's Forge material palette (mwpl), the one every Forge style swatch is
// named in (Ekur FORGE_PALETTE, crates/ekur/src/adapters/forge.rs).
const paletteForge = 0x4FD73754

// echantillonForge resolves a Forge swatch by its name hash into the layer it draws, before any
// tint: ok false when the swatch is unknown; a known swatch the game disables gives (nil, true).
type echantillonForge func(nom int32) (*Couche, bool)

// LitStylesForge resolves each style of a variant (mapvar.Variant.Styles, StyleGrimes) in the
// Forge material catalog `data`: a style none of whose swatches the catalog names is left out.
func LitStylesForge(data []byte, styles map[int32][]mapvar.StyleLayer, salissures map[int32]mapvar.StyleGrime) (map[int32]*StyleForge, error) {
	catalogue, err := lisCatalogueForge(data)
	if err != nil {
		return nil, err
	}
	return resoutStylesForge(catalogue, styles, salissures), nil
}

// lisCatalogueForge reads the reference catalog of Ekur layers as a swatch resolver.
func lisCatalogueForge(data []byte) (echantillonForge, error) {
	var doc struct {
		Layers map[string]struct {
			Name  int32           `json:"name"`
			Layer coucheCatalogue `json:"layer"`
		} `json:"layers"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("styles Forge : %w", err)
	}
	catalogue := map[int32]coucheCatalogue{}
	for _, e := range doc.Layers {
		catalogue[e.Name] = e.Layer
	}
	return func(nom int32) (*Couche, bool) {
		c, ok := catalogue[nom]
		if !ok {
			return nil, false
		}
		return c.couche(mapvar.StyleLayer{}), true
	}, nil
}

// echantillonsPaletteJeu resolves the swatches of the game's Forge palette (paletteForge) as the
// material styles do (echantillonBrut, the palette entry's swatch and color variant); nil when
// the palette is not in the modules. The reference catalog is a lossy export of this palette:
// Ekur keys it by each entry's notes string, so entries sharing one overwrite each other (324
// entries, 318 kept). Fortress's sandstone (-1773215225) and moss (-422696516) swatches are
// among the lost ones, and the walls that name them drew in their default grey concrete.
func echantillonsPaletteJeu(styles LecteurStyles) echantillonForge {
	pal, ok := styles(paletteForge)
	if !ok {
		return nil
	}
	po, nP, _, ok := blocRacine(pal, mwplOffSwatches, mwplTailleSwatch)
	if !ok {
		return nil
	}
	type entree struct{ ech, couleur uint32 }
	entrees := make(map[int32]entree, nP)
	for i := 0; i < nP; i++ {
		pe := po + i*mwplTailleSwatch
		nom := int32(u32(pal.tag, pe))
		if _, deja := entrees[nom]; !deja {
			entrees[nom] = entree{uint32(u32(pal.tag, pe+mwplOffSwatch)), uint32(u32(pal.tag, pe+mwplOffCouleur))}
		}
	}
	return func(nom int32) (*Couche, bool) {
		e, ok := entrees[nom]
		if !ok {
			return nil, false
		}
		k, ok := echantillonBrut(styles, e.ech, e.couleur)
		if !ok {
			return nil, true
		}
		return &k, true
	}
}

// enChaine resolves a swatch with the first resolver that knows it (nil resolvers are skipped).
func enChaine(resolveurs ...echantillonForge) echantillonForge {
	return func(nom int32) (*Couche, bool) {
		for _, r := range resolveurs {
			if r == nil {
				continue
			}
			if k, ok := r(nom); ok {
				return k, true
			}
		}
		return nil, false
	}
}

// StylesForgeJeu resolves the variant's styles from the game's own Forge palette (read through
// `styles`), the reference catalog `catalogue` (nil accepted) only for a swatch the game palette
// does not name.
func StylesForgeJeu(styles LecteurStyles, catalogue []byte, couches map[int32][]mapvar.StyleLayer, salissures map[int32]mapvar.StyleGrime) (map[int32]*StyleForge, error) {
	var cat echantillonForge
	if catalogue != nil {
		c, err := lisCatalogueForge(catalogue)
		if err != nil {
			return nil, err
		}
		cat = c
	}
	return resoutStylesForge(enChaine(echantillonsPaletteJeu(styles), cat), couches, salissures), nil
}

// resoutStylesForge resolves each style's zones and grime with `ech`, each zone tinted by its
// style layer (teinteCouche): a style none of whose swatches `ech` knows is left out. A zone
// keeps its rank: an empty or unknown swatch leaves that zone to the material.
func resoutStylesForge(ech echantillonForge, styles map[int32][]mapvar.StyleLayer, salissures map[int32]mapvar.StyleGrime) map[int32]*StyleForge {
	out := map[int32]*StyleForge{}
	for id, couches := range styles {
		s := &StyleForge{}
		nomme := false
		for z, l := range couches {
			if z >= len(s.Zones) {
				break
			}
			if k, ok := ech(l.Hash); ok {
				s.Zones[z] = teinteCouche(k, l)
				if k == nil && l.Tint != nil {
					s.Zones[z] = coucheUnie(l)
				}
				nomme = true
			}
		}
		if g, ok := salissures[id]; ok && g.Amount > 0 {
			if k, ok := ech(g.Hash); ok && k != nil {
				s.Salete, s.QuantiteSalete = k, float32(g.Amount)
			}
		}
		if nomme || s.Salete != nil {
			out[id] = s
		}
	}
	return out
}

// coucheUnie : the flat layer of a style layer whose swatch is the empty one (Forge's "Blank",
// -656357566: no gradient or normal map) with a color of its own: the color alone, at full
// strength, as there is no swatch color to blend it with. It has no bitmap (Bitmap 0): the zone
// it repaints lends its maps (ZonesStyle.couches). Fortress's Forerunner Platform panels name
// Blank with a near-black brown on their Mask0 R zone and drew the material's own pale blue-grey.
func coucheUnie(l mapvar.StyleLayer) *Couche {
	c := [3]float32{float32(l.Tint.X), float32(l.Tint.Y), float32(l.Tint.Z)}
	for i := range c {
		c[i] = min(max(c[i], 0), 1)
	}
	return &Couche{Sorte: CoucheDegrade, IndiceRouge: true, Transfo: transfoNeutre, Opacite: 1, Haut: c, Milieu: c, Bas: c}
}

// teinteCouche : a copy of layer k with its colors tinted by the style layer l (rgbCatalogue);
// nil stays nil.
func teinteCouche(k *Couche, l mapvar.StyleLayer) *Couche {
	if k == nil {
		return nil
	}
	t := *k
	t.Haut, t.Milieu, t.Bas = rgbCatalogue(k.Haut[:], l), rgbCatalogue(k.Milieu[:], l), rgbCatalogue(k.Bas[:], l)
	return &t
}

// couche turns a catalog layer into the layer a zone draws (before the material, adapte), its
// colors tinted by the style layer `l` (rgbCatalogue). nil for a layer Ekur disables.
func (c coucheCatalogue) couche(l mapvar.StyleLayer) *Couche {
	if c.Disabled || c.GradientBitmap == 0 || c.GradientBitmap == -1 ||
		(c.GradientBitmap == degradeVide && c.NormalBitmap == normaleVide) {
		return nil
	}
	k := &Couche{
		Sorte:       CoucheDegrade,
		IndiceRouge: true,
		Bitmap:      uint32(c.GradientBitmap),
		Transfo:     transfoCatalogue(c.GradientXform),
		Opacite:     1,
		Haut:        rgbCatalogue(c.TopJSON, l),
		Milieu:      rgbCatalogue(c.MidJSON, l),
		Bas:         rgbCatalogue(c.BotJSON, l),
		Matiere:     &MatiereCouche{Blanc: c.RoughnessWhite, Noir: c.RoughnessBlack, Metal: c.Metallic},
	}
	if c.NormalBitmap != 0 && c.NormalBitmap != -1 && c.NormalBitmap != normaleVide {
		k.Normale, k.TransfoNormale = uint32(c.NormalBitmap), transfoCatalogue(c.NormalXform)
	}
	return k
}

// transfoCatalogue : a catalog transform as a scale; a zero component counts as 1.
func transfoCatalogue(x [2]float32) Transfo {
	t := transfoNeutre
	for i, s := range x {
		if s != 0 {
			t.Echelle[i] = s
		}
	}
	return t
}

// rgbCatalogue : a catalog color moved toward l's color (Tint) by its intensity (Scalar, Ekur's
// color_intensity), bounded to [0, 1]. Ekur reads but never draws these (forge_level_reader.py),
// so the rule is ours: the colors are dark linear values (Fortress: 0.05 at intensity 0.2 to
// 0.6), which a product would turn black.
func rgbCatalogue(c []float32, l mapvar.StyleLayer) [3]float32 {
	var out [3]float32
	if len(c) != 3 {
		return out
	}
	var teinte [3]float32
	force := float32(0)
	if l.Tint != nil && l.Scalar > 0 {
		teinte = [3]float32{float32(l.Tint.X), float32(l.Tint.Y), float32(l.Tint.Z)}
		force = min(float32(l.Scalar), 1)
	}
	for i := range out {
		out[i] = min(max(c[i]+(teinte[i]-c[i])*force, 0), 1)
	}
	return out
}
