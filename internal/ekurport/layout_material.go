// Ported from Ekur's ekur_definitions (GPL-3.0-or-later, Copyright (c) 2026 The Halo
// Archive): material.rs MaterialTag / MaterialStyleInfo / MaterialParameter /
// MaterialPostProcessing.
//
// Piece 3 of the Ekur port: the raw struct layout of the "mat " tag's style_info,
// material_parameters, and post_process_definition blocks, decoded into plain Go structs
// with no transforms. A "mat " tag's main struct carries the material_parameters block
// at offset 0x2C (element MaterialParameter, size 0x9C), the post_process_definition
// block at 0x40 (element MaterialPostProcessing, size 0xA0), and the style_info block at
// 0x74 (element MaterialStyleInfo, size 0x5C), per material.rs MaterialTag. This reader
// returns the fields Ekur's material and coating code reads, exactly as stored.
package ekurport

// MaterialStyleInfo is one element of a "mat " tag's style_info block, raw as stored.
// Offsets are within the 0x5C element (material.rs MaterialStyleInfo).
type MaterialStyleInfo struct {
	// Stylelist is the global id of the material_style tag reference at +0x00 (a null
	// reference is -1); it names the style list this material uses.
	Stylelist int32
	// RegionName is the string id at +0x38.
	RegionName int32
	// The seven channel intentions, string ids: base +0x3C, mask0 red/green/blue
	// +0x40/+0x44/+0x48, mask1 red/green/blue +0x4C/+0x50/+0x54.
	BaseIntention       int32
	Mask0RedIntention   int32
	Mask0GreenIntention int32
	Mask0BlueIntention  int32
	Mask1RedIntention   int32
	Mask1GreenIntention int32
	Mask1BlueIntention  int32
	// SupportedLayers is the u8 enum byte at +0x58; RequiresDamage the u8 at +0x59.
	SupportedLayers uint8
	RequiresDamage  uint8
}

// MaterialParameter is one element of a "mat " tag's material_parameters block, raw as
// stored (material.rs MaterialParameter, size 0x9C): the fields Ekur's collect_textures
// reads.
type MaterialParameter struct {
	// Name is the parameter_name string id at +0x00.
	Name int32
	// Bitmap is the bitmap reference's global id at +0x10 (the FieldReference sits at
	// +0x08; a null reference is -1).
	Bitmap int32
	// Real is the real field f32 at +0x34.
	Real float32
	// VectorX/VectorY/VectorZ are the vector field components (FieldRealVector3D) at
	// +0x38/+0x3C/+0x40.
	VectorX float32
	VectorY float32
	VectorZ float32
}

// MaterialLayout is the raw decode of a "mat " tag's material_parameters,
// post_process_definition, and style_info blocks.
type MaterialLayout struct {
	StyleInfo   []MaterialStyleInfo
	Parameters  []MaterialParameter
	PostProcess int // element count of the post_process_definition block
}

// ReadMaterial decodes the material_parameters, post_process_definition, and style_info
// blocks of a "mat " tag's main struct.
func ReadMaterial(root Struct) (*MaterialLayout, error) {
	paramBlk, err := root.Block(0x2C, 0x9C) // material_parameters, element MaterialParameter 0x9C
	if err != nil {
		return nil, err
	}
	postBlk, err := root.Block(0x40, 0xA0) // post_process_definition, element MaterialPostProcessing 0xA0
	if err != nil {
		return nil, err
	}
	blk, err := root.Block(0x74, 0x5C) // style_info, element MaterialStyleInfo 0x5C
	if err != nil {
		return nil, err
	}
	out := &MaterialLayout{
		StyleInfo:   make([]MaterialStyleInfo, 0, blk.Len()),
		Parameters:  make([]MaterialParameter, 0, paramBlk.Len()),
		PostProcess: postBlk.Len(),
	}
	for i := 0; i < paramBlk.Len(); i++ {
		e := paramBlk.At(i)
		var p MaterialParameter
		if p.Name, err = sid(e, 0x00); err != nil {
			return nil, err
		}
		if p.Bitmap, err = refID(e, 0x08); err != nil {
			return nil, err
		}
		if p.Real, err = e.F32(0x34); err != nil {
			return nil, err
		}
		if p.VectorX, err = e.F32(0x38); err != nil {
			return nil, err
		}
		if p.VectorY, err = e.F32(0x3C); err != nil {
			return nil, err
		}
		if p.VectorZ, err = e.F32(0x40); err != nil {
			return nil, err
		}
		out.Parameters = append(out.Parameters, p)
	}
	for i := 0; i < blk.Len(); i++ {
		e := blk.At(i)
		var si MaterialStyleInfo
		if si.Stylelist, err = refID(e, 0x00); err != nil {
			return nil, err
		}
		if si.RegionName, err = sid(e, 0x38); err != nil {
			return nil, err
		}
		if si.BaseIntention, err = sid(e, 0x3C); err != nil {
			return nil, err
		}
		if si.Mask0RedIntention, err = sid(e, 0x40); err != nil {
			return nil, err
		}
		if si.Mask0GreenIntention, err = sid(e, 0x44); err != nil {
			return nil, err
		}
		if si.Mask0BlueIntention, err = sid(e, 0x48); err != nil {
			return nil, err
		}
		if si.Mask1RedIntention, err = sid(e, 0x4C); err != nil {
			return nil, err
		}
		if si.Mask1GreenIntention, err = sid(e, 0x50); err != nil {
			return nil, err
		}
		if si.Mask1BlueIntention, err = sid(e, 0x54); err != nil {
			return nil, err
		}
		if si.SupportedLayers, err = e.U8(0x58); err != nil {
			return nil, err
		}
		if si.RequiresDamage, err = e.U8(0x59); err != nil {
			return nil, err
		}
		out.StyleInfo = append(out.StyleInfo, si)
	}
	return out, nil
}
