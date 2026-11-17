// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Ported from Ekur's ekur_definitions (GPL-3.0-or-later, Copyright (c) 2026 The Halo
// Archive): coating_globals.rs CoatingGlobalsTag / CoatingIntentionDefinition and visor.rs
// MaterialVisorSwatchTag / MaterialVisorPatternReference / MaterialColorVariants.
//
// Piece 3 of the Ekur port: the raw struct layouts of the coating globals tag (global id
// 680672300) and the visor tag (global id -1260457915), decoded into plain Go structs with
// no transforms.
package ekurport

// CoatingIntentionDefinition is one element of the coating globals tag's
// global_shader_lookup block (coating_globals.rs CoatingIntentionDefinition, size 0x88): a
// name string id at +0x00, a fallback intention string id at +0x04, and an embedded
// CoatingPaletteInfo at +0x08.
type CoatingIntentionDefinition struct {
	Name     int32
	Fallback int32
	Info     CoatingPaletteInfo
}

// CoatingGlobalsLayout is the raw decode of the coating globals tag's main struct
// (coating_globals.rs CoatingGlobalsTag, size 0x38): the global_shader_lookup block.
type CoatingGlobalsLayout struct {
	Entries []CoatingIntentionDefinition
}

// ReadCoatingGlobals decodes the coating globals tag's main struct.
func ReadCoatingGlobals(root Struct) (*CoatingGlobalsLayout, error) {
	blk, err := root.Block(0x24, 0x88) // global_shader_lookup, element CoatingIntentionDefinition 0x88
	if err != nil {
		return nil, err
	}
	out := &CoatingGlobalsLayout{Entries: make([]CoatingIntentionDefinition, 0, blk.Len())}
	for i := 0; i < blk.Len(); i++ {
		e := blk.At(i)
		var def CoatingIntentionDefinition
		if def.Name, err = sid(e, 0x00); err != nil {
			return nil, err
		}
		if def.Fallback, err = sid(e, 0x04); err != nil {
			return nil, err
		}
		if def.Info, err = readCoatingPaletteInfo(e, 0x08); err != nil {
			return nil, err
		}
		out.Entries = append(out.Entries, def)
	}
	return out, nil
}

// VisorPatternReference is one element of the visor tag's pattern_variants block
// (visor.rs MaterialVisorPatternReference, size 0x20): a name string id at +0x00 and the
// global id of the swatch tag reference at +0x04 (null is -1). The pattern's fields live in
// the referenced "mwsw" swatch, which Ekur copies without a transform.
type VisorPatternReference struct {
	Name     int32
	SwatchID int32
}

// VisorColorVariant is one element of the visor tag's color_variants block (visor.rs
// MaterialColorVariants, size 0x30): a name string id at +0x00 and three RGB color triples
// at +0x04/+0x10/+0x1C.
type VisorColorVariant struct {
	Name     int32
	TopColor [3]float32
	MidColor [3]float32
	BotColor [3]float32
}

// VisorLayout is the raw decode of the visor tag's main struct (visor.rs
// MaterialVisorSwatchTag, size 0x38): the pattern_variants block (name + swatch reference)
// and the color_variants block (name + colors).
type VisorLayout struct {
	Patterns []VisorPatternReference
	Colors   []VisorColorVariant
}

// ReadVisor decodes the visor tag's main struct.
func ReadVisor(root Struct) (*VisorLayout, error) {
	out := &VisorLayout{}
	var err error

	patterns, err := root.Block(0x10, 0x20) // pattern_variants, element 0x20
	if err != nil {
		return nil, err
	}
	out.Patterns = make([]VisorPatternReference, 0, patterns.Len())
	for i := 0; i < patterns.Len(); i++ {
		e := patterns.At(i)
		var p VisorPatternReference
		if p.Name, err = sid(e, 0x00); err != nil {
			return nil, err
		}
		if p.SwatchID, err = refID(e, 0x04); err != nil {
			return nil, err
		}
		out.Patterns = append(out.Patterns, p)
	}

	colors, err := root.Block(0x24, 0x30) // color_variants, element 0x30
	if err != nil {
		return nil, err
	}
	out.Colors = make([]VisorColorVariant, 0, colors.Len())
	for i := 0; i < colors.Len(); i++ {
		e := colors.At(i)
		var c VisorColorVariant
		if c.Name, err = sid(e, 0x00); err != nil {
			return nil, err
		}
		for k, dst := range [...]*[3]float32{&c.TopColor, &c.MidColor, &c.BotColor} {
			var r, g, b float32
			if r, g, b, err = rgb(e, 0x04+12*k); err != nil {
				return nil, err
			}
			*dst = [3]float32{r, g, b}
		}
		out.Colors = append(out.Colors, c)
	}
	return out, nil
}
