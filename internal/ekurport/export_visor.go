// Ported from Ekur's ekur_customization (GPL-3.0-or-later, Copyright (c) 2026 The Halo
// Archive): visor.rs process_visor and the VisorPattern/VisorColor serde shapes it
// writes.
//
// Piece 4a of the Ekur port: the builder that turns the visor tag's raw layout (piece 3)
// into the value Ekur writes to visor_data.json. A pattern copies the fields of the mwsw
// swatch its reference points at; a color variant copies its three colors raw.
package ekurport

import "fmt"

// VisorPattern is one visor pattern of visor_data.json: the referenced mwsw swatch's
// fields, in serde declaration order (visor.rs:16-37).
type VisorPattern struct {
	ColorAndRoughnessTransform [2]float32 `json:"color_and_roughness_transform"`
	NormalTextureTransform     [2]float32 `json:"normal_texture_transform"`
	ColorGradientMap           int32      `json:"color_gradient_map"`
	RoughnessWhite             float32    `json:"roughness_white"`
	RoughnessBlack             float32    `json:"roughness_black"`
	NormalDetailMap            int32      `json:"normal_detail_map"`
	Metallic                   float32    `json:"metallic"`
	ScratchColor               [3]float32 `json:"scratch_color"`
	ScratchRoughness           float32    `json:"scratch_roughness"`
	ScratchMetallic            float32    `json:"scratch_metallic"`
}

// VisorColor is one visor color of visor_data.json: the three raw color triples
// (visor.rs:39-46).
type VisorColor struct {
	TopColor [3]float32 `json:"top_color"`
	MidColor [3]float32 `json:"mid_color"`
	BotColor [3]float32 `json:"bot_color"`
}

// VisorGlobals is the export of visor_data.json: patterns keyed by name string id,
// colors keyed by name string id.
type VisorGlobals struct {
	Patterns map[int32]VisorPattern `json:"patterns"`
	Colors   map[int32]VisorColor   `json:"colors"`
}

// ProcessVisor is process_visor (visor.rs:9-49).
func ProcessVisor(lay *VisorLayout, swatches map[int32]*MaterialSwatchLayout) (VisorGlobals, error) {
	out := VisorGlobals{Patterns: make(map[int32]VisorPattern, len(lay.Patterns)), Colors: make(map[int32]VisorColor, len(lay.Colors))}
	for _, p := range lay.Patterns {
		sw, ok := swatches[p.SwatchID]
		if !ok {
			return VisorGlobals{}, fmt.Errorf("ekurport: visor pattern %d: swatch %d not found", p.Name, p.SwatchID)
		}
		out.Patterns[p.Name] = VisorPattern{
			ColorAndRoughnessTransform: sw.ColorAndRoughnessTransform,
			NormalTextureTransform:     sw.NormalTextureTransform,
			ColorGradientMap:           sw.ColorGradientMap,
			RoughnessWhite:             sw.RoughnessWhite,
			RoughnessBlack:             sw.RoughnessBlack,
			NormalDetailMap:            sw.NormalDetailMap,
			Metallic:                   sw.Metallic,
			ScratchColor:               sw.ScratchColor,
			ScratchRoughness:           sw.ScratchRoughness,
			ScratchMetallic:            sw.ScratchMetallic,
		}
	}
	for _, c := range lay.Colors {
		out.Colors[c.Name] = VisorColor{TopColor: c.TopColor, MidColor: c.MidColor, BotColor: c.BotColor}
	}
	return out, nil
}
