// Ported from Ekur's ekur_materials (GPL-3.0-or-later, Copyright (c) 2026 The Halo
// Archive): process.rs process_material, layered/layered_shader.rs add_style_info and
// collect_textures, lib.rs Material / StyleInfo / TextureType, and
// ekur_definitions material.rs MaterialStyleShaderSupportedLayers.
//
// Piece 4b of the Ekur port: the material entries of materials/<id>.json, limited to the
// two fields the builders read: style_info and the Asg / Mask0 / Mask1 textures.
package ekurport

import "fmt"

// CommonStyleInfo is a material's style_info (lib.rs StyleInfo): the fields the builders
// read. Field names are Ekur's JSON keys.
type CommonStyleInfo struct {
	TexelDensity        [2]float32 `json:"texel_density"`
	MaterialOffset      [2]float32 `json:"material_offset"`
	Stylelist           int32      `json:"stylelist"`
	RegionName          int32      `json:"region_name"`
	BaseIntention       int32      `json:"base_intention"`
	Mask0RedIntention   int32      `json:"mask0_red_intention"`
	Mask0GreenIntention int32      `json:"mask0_green_intention"`
	Mask0BlueIntention  int32      `json:"mask0_blue_intention"`
	Mask1RedIntention   int32      `json:"mask1_red_intention"`
	Mask1GreenIntention int32      `json:"mask1_green_intention"`
	Mask1BlueIntention  int32      `json:"mask1_blue_intention"`
	SupportedLayers     int        `json:"supported_layers"`
}

// CommonMaterial is one materials/<id>.json entry, limited to the fields the builders
// read: style_info (null when the material has none) and the Asg / Mask0 / Mask1
// textures (a key is absent when no parameter names it; the value is the bitmap
// reference's global id).
type CommonMaterial struct {
	Textures  map[string]int32 `json:"textures"`
	StyleInfo *CommonStyleInfo `json:"style_info"`
}

// The parameter name string ids collect_textures matches (layered_shader.rs constants).
const (
	paramNameMask0Texture = int32(-1869712910)
	paramNameMask1Texture = int32(-1677269129)
	paramNameASGTexture   = int32(-447337164)
	paramNameTexelDensity = int32(523899303)
)

// ProcessMaterial is process_material (process.rs:43-120) with add_style_info and
// collect_textures, limited to the fields above. A material whose post_process block is
// empty gets the default entry: null style_info, no textures (process.rs:45-48).
func ProcessMaterial(lay *MaterialLayout) (CommonMaterial, error) {
	out := CommonMaterial{Textures: map[string]int32{}}
	if lay.PostProcess == 0 {
		return out, nil
	}
	var si *CommonStyleInfo
	if n := len(lay.StyleInfo); n > 0 {
		style := lay.StyleInfo[0]
		info := CommonStyleInfo{
			Stylelist:           style.Stylelist,
			RegionName:          style.RegionName,
			BaseIntention:       style.BaseIntention,
			Mask0RedIntention:   style.Mask0RedIntention,
			Mask0GreenIntention: style.Mask0GreenIntention,
			Mask0BlueIntention:  style.Mask0BlueIntention,
			Mask1RedIntention:   style.Mask1RedIntention,
			Mask1GreenIntention: style.Mask1GreenIntention,
			Mask1BlueIntention:  style.Mask1BlueIntention,
		}
		layers, err := supportedLayers(style.SupportedLayers)
		if err != nil {
			return CommonMaterial{}, err
		}
		info.SupportedLayers = layers
		si = &info
		out.StyleInfo = si
	}
	// collect_textures walks the parameter block in order, so the last parameter named
	// the same id wins (layered_shader.rs:19-55). With a style, the TEXEL_DENSITY
	// parameters also set texel_density / material_offset: (real, vec.x) and (vec.y,
	// vec.z). Both process_material passes read the same parameter list, so one walk
	// yields the same final map.
	for _, p := range lay.Parameters {
		switch p.Name {
		case paramNameMask0Texture:
			out.Textures["Mask0"] = p.Bitmap
		case paramNameMask1Texture:
			out.Textures["Mask1"] = p.Bitmap
		case paramNameASGTexture:
			out.Textures["Asg"] = p.Bitmap
		case paramNameTexelDensity:
			if si != nil {
				si.TexelDensity = [2]float32{p.Real, p.VectorX}
				si.MaterialOffset = [2]float32{p.VectorY, p.VectorZ}
			}
		}
	}
	return out, nil
}

// supportedLayers maps the raw enum byte to the value Ekur writes (layered_shader.rs
// 79-84; material.rs MaterialStyleShaderSupportedLayers, repr u8 in declaration order):
// 0 -> 1, 1 -> 4, 2 -> 7, 3 -> 0.
func supportedLayers(b uint8) (int, error) {
	switch b {
	case 0:
		return 1, nil
	case 1:
		return 4, nil
	case 2:
		return 7, nil
	case 3:
		return 0, nil
	}
	return 0, fmt.Errorf("ekurport: material style supported_layers byte %d out of range", b)
}
