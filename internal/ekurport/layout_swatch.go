// Ported from Ekur's ekur_definitions (GPL-3.0-or-later, Copyright (c) 2026 The Halo
// Archive): coating_swatch.rs CoatingSwatchPODTag.
//
// Piece 3 of the Ekur port: the raw struct layout of the "cmsw" tag (coating swatches),
// decoded into a plain Go struct with no transforms.
package ekurport

// CoatingSwatchLayout is the raw decode of a "cmsw" tag's main struct (coating_swatch.rs
// CoatingSwatchPODTag, size 0xD8).
type CoatingSwatchLayout struct {
	// ColorAndRoughnessTransform is the Vec2 at +0x2C; NormalTextureTransform the Vec2 at
	// +0x34.
	ColorAndRoughnessTransform [2]float32
	NormalTextureTransform     [2]float32
	// ColorGradientMap is the global id of the reference at +0x3C (null is -1).
	ColorGradientMap int32
	// The gradient colors are RGB triples at +0x58/+0x64/+0x70.
	GradientTop [3]float32
	GradientMid [3]float32
	GradientBot [3]float32
	// RoughnessWhite f32 +0x7C; RoughnessBlack +0x80; NormalDetailMap the global id of the
	// reference at +0x84 (null is -1); Metallic +0xA0.
	RoughnessWhite  float32
	RoughnessBlack  float32
	NormalDetailMap int32
	Metallic        float32
	// ScratchColor is the RGB triple at +0xAC; ScratchRoughness f32 +0xBC;
	// ScratchMetallic +0xC0; SSSIntensity +0xCC; EmissiveIntensity +0xD0;
	// EmissiveAmount +0xD4.
	ScratchColor      [3]float32
	ScratchRoughness  float32
	ScratchMetallic   float32
	SSSIntensity      float32
	EmissiveIntensity float32
	EmissiveAmount    float32
}

// ReadCoatingSwatch decodes a "cmsw" tag's main struct.
func ReadCoatingSwatch(root Struct) (*CoatingSwatchLayout, error) {
	out := &CoatingSwatchLayout{}
	var err error
	if x, y, e := vec2(root, 0x2C); e != nil {
		return nil, e
	} else {
		out.ColorAndRoughnessTransform = [2]float32{x, y}
	}
	if x, y, e := vec2(root, 0x34); e != nil {
		return nil, e
	} else {
		out.NormalTextureTransform = [2]float32{x, y}
	}
	if out.ColorGradientMap, err = refID(root, 0x3C); err != nil {
		return nil, err
	}
	for i, dst := range [...]*[3]float32{&out.GradientTop, &out.GradientMid, &out.GradientBot} {
		var r, g, b float32
		if r, g, b, err = rgb(root, 0x58+12*i); err != nil {
			return nil, err
		}
		*dst = [3]float32{r, g, b}
	}
	if out.RoughnessWhite, err = root.F32(0x7C); err != nil {
		return nil, err
	}
	if out.RoughnessBlack, err = root.F32(0x80); err != nil {
		return nil, err
	}
	if out.NormalDetailMap, err = refID(root, 0x84); err != nil {
		return nil, err
	}
	if out.Metallic, err = root.F32(0xA0); err != nil {
		return nil, err
	}
	if r, g, b, e := rgb(root, 0xAC); e != nil {
		return nil, e
	} else {
		out.ScratchColor = [3]float32{r, g, b}
	}
	if out.ScratchRoughness, err = root.F32(0xBC); err != nil {
		return nil, err
	}
	if out.ScratchMetallic, err = root.F32(0xC0); err != nil {
		return nil, err
	}
	if out.SSSIntensity, err = root.F32(0xCC); err != nil {
		return nil, err
	}
	if out.EmissiveIntensity, err = root.F32(0xD0); err != nil {
		return nil, err
	}
	if out.EmissiveAmount, err = root.F32(0xD4); err != nil {
		return nil, err
	}
	return out, nil
}
