// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Ported from Ekur's ekur_coating (GPL-3.0-or-later, Copyright (c) 2026 The Halo
// Archive): common_coating.rs CommonLayer::from_runtime / from_material and get_color,
// plus the ekur_definitions enums they branch on (runtime_style.rs OverrideColorsEnum,
// material_palette.rs MaterialRoughnessOverride).
//
// Piece 4a of the Ekur port: the layer export that globals.json and styles/ embed. The
// type carries the serde field names and order Ekur writes; the constructors carry the
// transforms (roughness, emissive, scratch, color flags, disabled detection) from
// common_coating.rs.
package ekurport

import "fmt"

// The default texture ids: a swatch whose normal detail map is 10070 AND whose color
// gradient map is 15173 marks a disabled layer (common_coating.rs:15-16).
const (
	defaultNormalMapID = 10070
	defaultGradientID  = 15173
)

// CommonLayer is one layer of the export the coating builders read, with Ekur's serde
// field names and declaration order (common_coating.rs CommonLayer).
type CommonLayer struct {
	Index             int32      `json:"index"`
	Disabled          bool       `json:"disabled"`
	GradientTransform [2]float32 `json:"gradient_transform"`
	NormalTransform   [2]float32 `json:"normal_transform"`
	GradientBitmap    int32      `json:"gradient_bitmap"`
	NormalBitmap      int32      `json:"normal_bitmap"`
	Roughness         float32    `json:"roughness"`
	RoughnessWhite    float32    `json:"roughness_white"`
	RoughnessBlack    float32    `json:"roughness_black"`
	Metallic          float32    `json:"metallic"`
	EmissiveAmount    float32    `json:"emissive_amount"`
	TopColor          [3]float32 `json:"top_color"`
	MidColor          [3]float32 `json:"mid_color"`
	BotColor          [3]float32 `json:"bot_color"`
	ScratchRoughness  float32    `json:"scratch_roughness"`
	ScratchMetallic   float32    `json:"scratch_metallic"`
	ScratchColor      [3]float32 `json:"scratch_color"`
}

// gradientColors applies the gradient color flag (common_coating.rs get_color): flag 0 is
// OverrideColors (the palette info's colors, runtime_style.rs:12-14), flag 1 is
// UseDefaultColors (the swatch's own gradient colors).
func gradientColors(flag uint8, sw *CoatingSwatchLayout, info CoatingPaletteInfo) (top, mid, bot [3]float32) {
	if flag == 1 {
		return sw.GradientTop, sw.GradientMid, sw.GradientBot
	}
	return info.GradientTop, info.GradientMid, info.GradientBot
}

// layerFromRuntime is CommonLayer::from_runtime (common_coating.rs:139-198). A null
// swatch reference (-1) gives a disabled layer of all default (zero) fields, including
// index 0. Roughness is 4 + 4*offset, emissive is amount + intensity*0.5, scratch
// roughness is scaled by (1 + offset) — all in float32, as the Rust f32 arithmetic is.
func layerFromRuntime(info CoatingPaletteInfo, swatches map[int32]*CoatingSwatchLayout, index int32) (CommonLayer, error) {
	if info.Swatch == -1 {
		return CommonLayer{Disabled: true}, nil
	}
	sw, ok := swatches[info.Swatch]
	if !ok {
		return CommonLayer{}, fmt.Errorf("ekurport: coating swatch %d not found", info.Swatch)
	}
	scratch := sw.ScratchColor
	if info.ScratchColorFlag == 0 { // OverrideColors
		scratch = info.ScratchColor
	}
	top, mid, bot := gradientColors(info.GradientColorFlag, sw, info)
	return CommonLayer{
		Index:             index,
		Disabled:          sw.NormalDetailMap == defaultNormalMapID && sw.ColorGradientMap == defaultGradientID,
		GradientTransform: sw.ColorAndRoughnessTransform,
		NormalTransform:   sw.NormalTextureTransform,
		GradientBitmap:    sw.ColorGradientMap,
		NormalBitmap:      sw.NormalDetailMap,
		Roughness:         4.0 + 4.0*info.RoughnessOffset,
		RoughnessWhite:    sw.RoughnessWhite,
		RoughnessBlack:    sw.RoughnessBlack,
		Metallic:          sw.Metallic,
		EmissiveAmount:    info.EmissiveAmount + info.EmissiveIntensity*0.5,
		TopColor:          top,
		MidColor:          mid,
		BotColor:          bot,
		ScratchRoughness:  sw.ScratchRoughness * (1.0 + info.ScratchRoughnessOffset),
		ScratchMetallic:   sw.ScratchMetallic,
		ScratchColor:      scratch,
	}, nil
}

// layerFromMaterial is CommonLayer::from_material (common_coating.rs:62-137): the layer
// colors come from the swatch's color variant named by the palette entry (a missing
// variant gives a disabled layer of zero colors), and the roughness enum value is the
// layer's roughness. Emissive is amount + intensity with no 0.5 factor.
func layerFromMaterial(sw *MaterialSwatchLayout, entry *MaterialSwatchEntry, index int32) CommonLayer {
	disabled := false
	var color *MaterialColorVariant
	for i := range sw.ColorVariants {
		if sw.ColorVariants[i].Name == entry.Color {
			color = &sw.ColorVariants[i]
			break
		}
	}
	if color == nil {
		disabled = true
	}
	if sw.NormalDetailMap == defaultNormalMapID && sw.ColorGradientMap == defaultGradientID {
		disabled = true
	}
	var top, mid, bot [3]float32
	if color != nil {
		top, mid, bot = color.TopColor, color.MidColor, color.BotColor
	}
	return CommonLayer{
		Index:             index,
		Disabled:          disabled,
		GradientTransform: sw.ColorAndRoughnessTransform,
		NormalTransform:   sw.NormalTextureTransform,
		GradientBitmap:    sw.ColorGradientMap,
		NormalBitmap:      sw.NormalDetailMap,
		Roughness:         float32(entry.RoughnessOverride),
		RoughnessWhite:    sw.RoughnessWhite,
		RoughnessBlack:    sw.RoughnessBlack,
		Metallic:          sw.Metallic,
		EmissiveAmount:    entry.EmissiveAmount + entry.EmissiveIntensity,
		TopColor:          top,
		MidColor:          mid,
		BotColor:          bot,
		ScratchRoughness:  sw.ScratchRoughness,
		ScratchMetallic:   sw.ScratchMetallic,
		ScratchColor:      sw.ScratchColor,
	}
}
