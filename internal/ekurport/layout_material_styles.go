// Ported from Ekur's ekur_definitions (GPL-3.0-or-later, Copyright (c) 2026 The Halo
// Archive): material_styles.rs MaterialStylesTag / MaterialStyle / MaterialStyleRegion /
// MaterialLayer / MaterialRegion / IntentionConversionElement, material_palette.rs
// MaterialPaletteTag / MaterialSwatchEntry, and material_swatch.rs MaterialSwatchTag /
// MaterialColorVariant.
//
// Piece 3 of the Ekur port: the raw struct layouts of the "mwsy" (material styles), "mwpl"
// (material palettes) and "mwsw" (material swatches) tags, decoded into plain Go structs
// with no transforms.
package ekurport

// MaterialLayer is one element of a mwsy style region's layers block (material_styles.rs
// MaterialLayer, size 0x48): an i64 element id at +0x00 and a name string id at +0x08.
type MaterialLayer struct {
	ElementID int64
	Name      int32
}

// MaterialStyleRegion is one element of a mwsy style's regions block (material_styles.rs
// MaterialStyleRegion, size 0x28): a name string id at +0x00 and a layers block at +0x08.
type MaterialStyleRegion struct {
	Name   int32
	Layers []MaterialLayer
}

// MaterialStyle is one element of a "mwsy" tag's styles block (material_styles.rs
// MaterialStyle, size 0x5C).
type MaterialStyle struct {
	// Name is the string id at +0x00; Palette the global id of the palette tag reference
	// at +0x04 (null is -1).
	Name    int32
	Palette int32
	// GrimeType is the string id at +0x34; GrimeAmount the f32 at +0x38; ScratchAmount
	// the f32 at +0x30.
	GrimeType     int32
	GrimeAmount   float32
	ScratchAmount float32
	// Regions is the block at +0x3C (element MaterialStyleRegion 0x28).
	Regions []MaterialStyleRegion
}

// MaterialRegion is one element of a "mwsy" tag's (top-level) regions block
// (material_styles.rs MaterialRegion, size 0x18): a name string id at +0x00 and an
// intention_conversion_list block at +0x04 (element IntentionConversionElement 0x04, a
// single intention_name string id).
type MaterialRegion struct {
	Name                int32
	IntentionConversion []int32
}

// MaterialStylesLayout is the raw decode of a "mwsy" tag's main struct (material_styles.rs
// MaterialStylesTag): the styles block and the top-level regions block.
type MaterialStylesLayout struct {
	Styles  []MaterialStyle
	Regions []MaterialRegion
}

// ReadMaterialStyles decodes a "mwsy" tag's main struct.
func ReadMaterialStyles(root Struct) (*MaterialStylesLayout, error) {
	out := &MaterialStylesLayout{}
	var err error

	styles, err := root.Block(0x50, 0x5C) // styles, element MaterialStyle 0x5C
	if err != nil {
		return nil, err
	}
	out.Styles = make([]MaterialStyle, 0, styles.Len())
	for i := 0; i < styles.Len(); i++ {
		e := styles.At(i)
		var st MaterialStyle
		if st.Name, err = sid(e, 0x00); err != nil {
			return nil, err
		}
		if st.Palette, err = refID(e, 0x04); err != nil {
			return nil, err
		}
		if st.ScratchAmount, err = e.F32(0x30); err != nil {
			return nil, err
		}
		if st.GrimeType, err = sid(e, 0x34); err != nil {
			return nil, err
		}
		if st.GrimeAmount, err = e.F32(0x38); err != nil {
			return nil, err
		}
		regs, err := e.Block(0x3C, 0x28) // regions, element MaterialStyleRegion 0x28
		if err != nil {
			return nil, err
		}
		st.Regions = make([]MaterialStyleRegion, 0, regs.Len())
		for j := 0; j < regs.Len(); j++ {
			re := regs.At(j)
			var reg MaterialStyleRegion
			if reg.Name, err = sid(re, 0x00); err != nil {
				return nil, err
			}
			layers, err := re.Block(0x08, 0x48) // layers, element MaterialLayer 0x48
			if err != nil {
				return nil, err
			}
			reg.Layers = make([]MaterialLayer, 0, layers.Len())
			for k := 0; k < layers.Len(); k++ {
				le := layers.At(k)
				var lay MaterialLayer
				b, err := le.Bytes(0x00, 8)
				if err != nil {
					return nil, err
				}
				lay.ElementID = int64(littleUint64(b))
				if lay.Name, err = sid(le, 0x08); err != nil {
					return nil, err
				}
				reg.Layers = append(reg.Layers, lay)
			}
			st.Regions = append(st.Regions, reg)
		}
		out.Styles = append(out.Styles, st)
	}

	// Top-level regions block (used to rename layers via intention_conversion_list).
	regs, err := root.Block(0x10, 0x18) // regions, element MaterialRegion 0x18
	if err != nil {
		return nil, err
	}
	out.Regions = make([]MaterialRegion, 0, regs.Len())
	for i := 0; i < regs.Len(); i++ {
		e := regs.At(i)
		var reg MaterialRegion
		if reg.Name, err = sid(e, 0x00); err != nil {
			return nil, err
		}
		conv, err := e.Block(0x04, 0x04) // intention_conversion_list, element 0x04
		if err != nil {
			return nil, err
		}
		reg.IntentionConversion = make([]int32, 0, conv.Len())
		for j := 0; j < conv.Len(); j++ {
			v, err := sid(conv.At(j), 0x00)
			if err != nil {
				return nil, err
			}
			reg.IntentionConversion = append(reg.IntentionConversion, v)
		}
		out.Regions = append(out.Regions, reg)
	}
	return out, nil
}

// MaterialSwatchEntry is one element of a "mwpl" tag's swatches block (material_palette.rs
// MaterialSwatchEntry, size 0x38).
type MaterialSwatchEntry struct {
	// Name is the string id at +0x00; Swatch the global id of the swatch tag reference at
	// +0x04 (null is -1); Color the string id at +0x20.
	Name   int32
	Swatch int32
	Color  int32
	// RoughnessOverride is the u8 enum at +0x24; EmissiveIntensity the f32 at +0x28;
	// EmissiveAmount the f32 at +0x2C; Notes the string id at +0x30.
	RoughnessOverride uint8
	EmissiveIntensity float32
	EmissiveAmount    float32
	Notes             int32
}

// MaterialPaletteLayout is the raw decode of a "mwpl" tag's main struct (material_palette.rs
// MaterialPaletteTag): the swatches block.
type MaterialPaletteLayout struct {
	Swatches []MaterialSwatchEntry
}

// ReadMaterialPalette decodes a "mwpl" tag's main struct.
func ReadMaterialPalette(root Struct) (*MaterialPaletteLayout, error) {
	blk, err := root.Block(0x10, 0x38) // swatches, element MaterialSwatchEntry 0x38
	if err != nil {
		return nil, err
	}
	out := &MaterialPaletteLayout{Swatches: make([]MaterialSwatchEntry, 0, blk.Len())}
	for i := 0; i < blk.Len(); i++ {
		e := blk.At(i)
		var sw MaterialSwatchEntry
		if sw.Name, err = sid(e, 0x00); err != nil {
			return nil, err
		}
		if sw.Swatch, err = refID(e, 0x04); err != nil {
			return nil, err
		}
		if sw.Color, err = sid(e, 0x20); err != nil {
			return nil, err
		}
		if sw.RoughnessOverride, err = e.U8(0x24); err != nil {
			return nil, err
		}
		if sw.EmissiveIntensity, err = e.F32(0x28); err != nil {
			return nil, err
		}
		if sw.EmissiveAmount, err = e.F32(0x2C); err != nil {
			return nil, err
		}
		if sw.Notes, err = sid(e, 0x30); err != nil {
			return nil, err
		}
		out.Swatches = append(out.Swatches, sw)
	}
	return out, nil
}

// MaterialColorVariant is one element of a "mwsw" tag's color_variants block
// (material_swatch.rs MaterialColorVariant, size 0x30): a name string id at +0x00 and three
// RGB color triples at +0x04/+0x10/+0x1C.
type MaterialColorVariant struct {
	Name     int32
	TopColor [3]float32
	MidColor [3]float32
	BotColor [3]float32
}

// MaterialSwatchLayout is the raw decode of a "mwsw" tag's main struct (material_swatch.rs
// MaterialSwatchTag). It is also the source of every visor pattern's fields: Ekur copies a
// visor pattern from the mwsw swatch its pattern reference points at.
type MaterialSwatchLayout struct {
	// ColorAndRoughnessTransform is the Vec2 at +0x10; NormalTextureTransform the Vec2 at
	// +0x18.
	ColorAndRoughnessTransform [2]float32
	NormalTextureTransform     [2]float32
	// ColorGradientMap is the global id of the reference at +0x20; NormalDetailMap the
	// global id of the reference at +0x44 (null is -1).
	ColorGradientMap int32
	NormalDetailMap  int32
	// RoughnessWhite f32 +0x3C; RoughnessBlack +0x40; Metallic +0x60; SSSStrength +0x6C;
	// ScratchRoughness +0x80; ScratchMetallic +0x84; SSSIntensity +0x90.
	RoughnessWhite   float32
	RoughnessBlack   float32
	Metallic         float32
	SSSStrength      float32
	ScratchRoughness float32
	ScratchMetallic  float32
	SSSIntensity     float32
	// ScratchColor is the RGB triple at +0x70.
	ScratchColor [3]float32
	// ColorVariants is the block at +0x94 (element MaterialColorVariant 0x30).
	ColorVariants []MaterialColorVariant
}

// ReadMaterialSwatch decodes a "mwsw" tag's main struct.
func ReadMaterialSwatch(root Struct) (*MaterialSwatchLayout, error) {
	out := &MaterialSwatchLayout{}
	var err error
	if x, y, e := vec2(root, 0x10); e != nil {
		return nil, e
	} else {
		out.ColorAndRoughnessTransform = [2]float32{x, y}
	}
	if x, y, e := vec2(root, 0x18); e != nil {
		return nil, e
	} else {
		out.NormalTextureTransform = [2]float32{x, y}
	}
	if out.ColorGradientMap, err = refID(root, 0x20); err != nil {
		return nil, err
	}
	if out.RoughnessWhite, err = root.F32(0x3C); err != nil {
		return nil, err
	}
	if out.RoughnessBlack, err = root.F32(0x40); err != nil {
		return nil, err
	}
	if out.NormalDetailMap, err = refID(root, 0x44); err != nil {
		return nil, err
	}
	if out.Metallic, err = root.F32(0x60); err != nil {
		return nil, err
	}
	if out.SSSStrength, err = root.F32(0x6C); err != nil {
		return nil, err
	}
	if r, g, b, e := rgb(root, 0x70); e != nil {
		return nil, e
	} else {
		out.ScratchColor = [3]float32{r, g, b}
	}
	if out.ScratchRoughness, err = root.F32(0x80); err != nil {
		return nil, err
	}
	if out.ScratchMetallic, err = root.F32(0x84); err != nil {
		return nil, err
	}
	if out.SSSIntensity, err = root.F32(0x90); err != nil {
		return nil, err
	}

	blk, err := root.Block(0x94, 0x30) // color_variants, element MaterialColorVariant 0x30
	if err != nil {
		return nil, err
	}
	out.ColorVariants = make([]MaterialColorVariant, 0, blk.Len())
	for i := 0; i < blk.Len(); i++ {
		e := blk.At(i)
		var cv MaterialColorVariant
		if cv.Name, err = sid(e, 0x00); err != nil {
			return nil, err
		}
		for k, dst := range [...]*[3]float32{&cv.TopColor, &cv.MidColor, &cv.BotColor} {
			var r, g, b float32
			if r, g, b, err = rgb(e, 0x04+12*k); err != nil {
				return nil, err
			}
			*dst = [3]float32{r, g, b}
		}
		out.ColorVariants = append(out.ColorVariants, cv)
	}
	return out, nil
}
