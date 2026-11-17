// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Ported from Ekur's ekur_definitions (GPL-3.0-or-later, Copyright (c) 2026 The Halo
// Archive): runtime_styles.rs RuntimeCoatingStyles / RuntimeCoatingStyleRef and
// runtime_style.rs RuntimeCoatingStyle / RuntimeCoatingRegion / RuntimeCoatingIntention /
// CoatingPaletteInfo.
//
// Piece 3 of the Ekur port: the raw struct layouts of the "rucs" (style lists) and "rucy"
// (styles) tags, decoded into plain Go structs with no transforms.
package ekurport

import (
	"encoding/binary"
)

// CoatingPaletteInfo is the 0x80 embedded palette block shared by the runtime style and
// coating globals tags (runtime_style.rs CoatingPaletteInfo). Offsets are within the
// 0x80 block.
type CoatingPaletteInfo struct {
	// ElementID is the i64 at +0x00; Description the string id at +0x08.
	ElementID   int64
	Description int32
	// Swatch is the global id of the swatch tag reference at +0x0C (null is -1).
	Swatch int32
	// GradientColorFlag is the u8 enum at +0x28; the gradient colors are RGB triples at
	// +0x2C/+0x38/+0x44.
	GradientColorFlag uint8
	GradientTop       [3]float32
	GradientMid       [3]float32
	GradientBot       [3]float32
	// RoughnessOffset is the f32 at +0x50; ScratchColorFlag the u8 at +0x54; ScratchColor
	// the RGB triple at +0x58; ScratchRoughnessOffset the f32 at +0x64.
	RoughnessOffset        float32
	ScratchColorFlag       uint8
	ScratchColor           [3]float32
	ScratchRoughnessOffset float32
	// UseEmissive is the u8 at +0x68; EmissiveIntensity the f32 at +0x6C; EmissiveAmount
	// the f32 at +0x70; SubsurfaceUsage the u16 at +0x76.
	UseEmissive       uint8
	EmissiveIntensity float32
	EmissiveAmount    float32
	SubsurfaceUsage   uint16
}

// readCoatingPaletteInfo decodes a CoatingPaletteInfo block at field offset off.
func readCoatingPaletteInfo(s Struct, off int) (CoatingPaletteInfo, error) {
	var p CoatingPaletteInfo
	b, err := s.Bytes(off, 8)
	if err != nil {
		return p, err
	}
	p.ElementID = int64(binary.LittleEndian.Uint64(b))
	if p.Description, err = sid(s, off+0x08); err != nil {
		return p, err
	}
	if p.Swatch, err = refID(s, off+0x0C); err != nil {
		return p, err
	}
	if p.GradientColorFlag, err = s.U8(off + 0x28); err != nil {
		return p, err
	}
	for i, dst := range [...]*[3]float32{&p.GradientTop, &p.GradientMid, &p.GradientBot} {
		var r, g, bb float32
		if r, g, bb, err = rgb(s, off+0x2C+12*i); err != nil {
			return p, err
		}
		*dst = [3]float32{r, g, bb}
	}
	if p.RoughnessOffset, err = s.F32(off + 0x50); err != nil {
		return p, err
	}
	if p.ScratchColorFlag, err = s.U8(off + 0x54); err != nil {
		return p, err
	}
	var r, g, bb float32
	if r, g, bb, err = rgb(s, off+0x58); err != nil {
		return p, err
	}
	p.ScratchColor = [3]float32{r, g, bb}
	if p.ScratchRoughnessOffset, err = s.F32(off + 0x64); err != nil {
		return p, err
	}
	if p.UseEmissive, err = s.U8(off + 0x68); err != nil {
		return p, err
	}
	if p.EmissiveIntensity, err = s.F32(off + 0x6C); err != nil {
		return p, err
	}
	if p.EmissiveAmount, err = s.F32(off + 0x70); err != nil {
		return p, err
	}
	if p.SubsurfaceUsage, err = s.U16(off + 0x76); err != nil {
		return p, err
	}
	return p, nil
}

// RuntimeCoatingStyleRef is one element of a "rucs" tag's styles block (runtime_styles.rs
// RuntimeCoatingStyleRef, size 0x24). Name is the string id at +0x00; StyleRef the global
// id of the style_ref tag reference at +0x08 (null is -1).
type RuntimeCoatingStyleRef struct {
	Name     int32
	StyleRef int32
}

// RuntimeCoatingStylesLayout is the raw decode of a "rucs" tag's main struct
// (runtime_styles.rs RuntimeCoatingStyles): the styles block and the default style index.
type RuntimeCoatingStylesLayout struct {
	Styles            []RuntimeCoatingStyleRef
	DefaultStyleIndex int32
}

// ReadRuntimeCoatingStyles decodes a "rucs" tag's main struct.
func ReadRuntimeCoatingStyles(root Struct) (*RuntimeCoatingStylesLayout, error) {
	blk, err := root.Block(0x10, 0x24) // styles, element RuntimeCoatingStyleRef 0x24
	if err != nil {
		return nil, err
	}
	out := &RuntimeCoatingStylesLayout{Styles: make([]RuntimeCoatingStyleRef, 0, blk.Len())}
	for i := 0; i < blk.Len(); i++ {
		e := blk.At(i)
		var ref RuntimeCoatingStyleRef
		if ref.Name, err = sid(e, 0x00); err != nil {
			return nil, err
		}
		if ref.StyleRef, err = refID(e, 0x08); err != nil {
			return nil, err
		}
		out.Styles = append(out.Styles, ref)
	}
	if out.DefaultStyleIndex, err = root.I32(0x40); err != nil {
		return nil, err
	}
	return out, nil
}

// RuntimeCoatingIntention is one element of a "rucy" region's intentions block
// (runtime_style.rs RuntimeCoatingIntention, size 0x88): a name string id and an embedded
// CoatingPaletteInfo at +0x08.
type RuntimeCoatingIntention struct {
	Name int32
	Info CoatingPaletteInfo
}

// RuntimeCoatingRegion is one element of a "rucy" tag's regions block (runtime_style.rs
// RuntimeCoatingRegion, size 0x34): a name string id at +0x00 and an intentions block at
// +0x20.
type RuntimeCoatingRegion struct {
	Name       int32
	Intentions []RuntimeCoatingIntention
}

// RuntimeCoatingStyleLayout is the raw decode of a "rucy" tag's main struct
// (runtime_style.rs RuntimeCoatingStyle): the grime/scratch scalars, the grime swatch
// palette, and the regions.
type RuntimeCoatingStyleLayout struct {
	GrimeAmount   float32
	ScratchAmount float32
	GrimeSwatch   CoatingPaletteInfo
	Regions       []RuntimeCoatingRegion
}

// ReadRuntimeCoatingStyle decodes a "rucy" tag's main struct.
func ReadRuntimeCoatingStyle(root Struct) (*RuntimeCoatingStyleLayout, error) {
	out := &RuntimeCoatingStyleLayout{}
	var err error
	// info is embedded at +0x10 (size 0x218); within it grime_amount is +0x210 and
	// scratch_amount is +0x188, and the grime_swatch palette is at +0x190.
	if out.ScratchAmount, err = root.F32(0x10 + 0x188); err != nil {
		return nil, err
	}
	if out.GrimeAmount, err = root.F32(0x10 + 0x210); err != nil {
		return nil, err
	}
	if out.GrimeSwatch, err = readCoatingPaletteInfo(root, 0x10+0x190); err != nil {
		return nil, err
	}

	regions, err := root.Block(0x228, 0x34) // regions, element RuntimeCoatingRegion 0x34
	if err != nil {
		return nil, err
	}
	out.Regions = make([]RuntimeCoatingRegion, 0, regions.Len())
	for i := 0; i < regions.Len(); i++ {
		e := regions.At(i)
		var reg RuntimeCoatingRegion
		if reg.Name, err = sid(e, 0x00); err != nil {
			return nil, err
		}
		intentions, err := e.Block(0x20, 0x88) // intentions, element RuntimeCoatingIntention 0x88
		if err != nil {
			return nil, err
		}
		reg.Intentions = make([]RuntimeCoatingIntention, 0, intentions.Len())
		for j := 0; j < intentions.Len(); j++ {
			el := intentions.At(j)
			var it RuntimeCoatingIntention
			if it.Name, err = sid(el, 0x00); err != nil {
				return nil, err
			}
			if it.Info, err = readCoatingPaletteInfo(el, 0x08); err != nil {
				return nil, err
			}
			reg.Intentions = append(reg.Intentions, it)
		}
		out.Regions = append(out.Regions, reg)
	}
	return out, nil
}
