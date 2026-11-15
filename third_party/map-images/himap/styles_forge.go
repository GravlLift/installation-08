// Package himap — styles_forge.go (LOCAL-CHANGE (infinite-theater-3d)): an object's own Forge
// material style.
//
// A Forge map gives most of its objects a material of their own (`.mvar` root field 8; Fortress:
// 3 390 of 5 504 objects): up to four layers, the swatches of the material's zones 1 to 4 with a
// tint (mapvar.StyleLayer), and a grime swatch with its amount (mapvar.StyleGrime), as Ekur's
// add-on reads them (forge_level_reader.py, ForgeMat). The swatches are named by hash and
// resolved in a reference catalog of Ekur layers (forge_materials.json: gradient and normal maps,
// their transforms, the bottom / middle / top colors). The style repaints the zones of the
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

// LitStylesForge resolves each style of a variant (mapvar.Variant.Styles, StyleGrimes) in the
// Forge material catalog `data`: a style none of whose swatches the catalog names is left out.
func LitStylesForge(data []byte, styles map[int32][]mapvar.StyleLayer, salissures map[int32]mapvar.StyleGrime) (map[int32]*StyleForge, error) {
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
	out := map[int32]*StyleForge{}
	for id, couches := range styles {
		s := &StyleForge{}
		nomme := false
		for z, l := range couches {
			if z >= len(s.Zones) {
				break
			}
			if c, ok := catalogue[l.Hash]; ok {
				s.Zones[z] = c.couche(l)
				nomme = true
			}
		}
		if g, ok := salissures[id]; ok && g.Amount > 0 {
			if c, ok := catalogue[g.Hash]; ok {
				s.Salete, s.QuantiteSalete = c.couche(mapvar.StyleLayer{}), float32(g.Amount)
			}
		}
		if nomme || s.Salete != nil {
			out[id] = s
		}
	}
	return out, nil
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
