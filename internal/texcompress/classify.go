package texcompress

import (
	"encoding/json"
)

// Class is what an image's texels mean to the viewer, which picks its encoding settings.
type Class int

const (
	// ClassData is linear data: control maps (roughness, occlusion, metal, height), blend masks,
	// gradient indexes, cut-out alphas. Every channel is independent.
	ClassData Class = iota
	// ClassColor is sRGB color: layer color maps, base color, emissive masks, the sky's clouds.
	ClassColor
	// ClassNormal is a tangent-space normal map (X, Y, Z in R, G, B).
	ClassNormal
)

func (c Class) String() string {
	switch c {
	case ClassColor:
		return "color"
	case ClassNormal:
		return "normal"
	default:
		return "data"
	}
}

// classify returns each image's class from the places the document references its textures:
// the glTF material slots, and the layered materials' and raw surfaces' extras the himap writer
// adds (glb_couches.go, glb_surfaces_brutes.go, ciel.go). An image referenced as a normal map
// anywhere is a normal map; otherwise one referenced as color anywhere is color; everything else,
// unreferenced images included, is data unless it is a JPEG (the writer only writes color as JPEG).
func classify(doc map[string]any) []Class {
	images, _ := doc["images"].([]any)
	textures, _ := doc["textures"].([]any)
	out := make([]Class, len(images))
	seen := make([]bool, len(images))
	for i, im := range images {
		if m, _ := im.(map[string]any); m != nil && m["mimeType"] == mimeJPEG {
			out[i] = ClassColor
		}
	}
	mark := func(tex any, c Class) {
		t, ok := entier(tex)
		if !ok || t < 0 || t >= len(textures) {
			return
		}
		src, ok := textureSource(textures[t])
		if !ok || src < 0 || src >= len(images) {
			return
		}
		switch {
		case !seen[src]:
			out[src] = c
		case c == ClassNormal:
			out[src] = ClassNormal
		case c == ClassColor && out[src] == ClassData:
			out[src] = ClassColor
		}
		seen[src] = true
	}
	info := func(v any) any {
		m, _ := v.(map[string]any)
		if m == nil {
			return nil
		}
		return m["index"]
	}
	materials, _ := doc["materials"].([]any)
	for _, mv := range materials {
		m, _ := mv.(map[string]any)
		if m == nil {
			continue
		}
		if pbr, _ := m["pbrMetallicRoughness"].(map[string]any); pbr != nil {
			mark(info(pbr["baseColorTexture"]), ClassColor)
			mark(info(pbr["metallicRoughnessTexture"]), ClassData)
		}
		mark(info(m["emissiveTexture"]), ClassColor)
		mark(info(m["normalTexture"]), ClassNormal)
		mark(info(m["occlusionTexture"]), ClassData)
		extras, _ := m["extras"].(map[string]any)
		if extras == nil {
			continue
		}
		if c, _ := extras["couches"].(map[string]any); c != nil {
			mark(c["masque"], ClassData)
			layers, _ := c["couches"].([]any)
			for _, lv := range layers {
				l, _ := lv.(map[string]any)
				if l == nil {
					continue
				}
				if l["sorte"] == "couleur" {
					mark(l["texture"], ClassColor)
				} else {
					mark(l["texture"], ClassData)
				}
				mark(l["normale"], ClassNormal)
				mark(l["controle"], ClassData)
			}
		}
		if s, _ := extras["surfaceBrute"].(map[string]any); s != nil {
			for _, k := range []string{"asg", "masque0", "masque1"} {
				mark(s[k], ClassData)
			}
		}
	}
	scenes, _ := doc["scenes"].([]any)
	for _, sv := range scenes {
		s, _ := sv.(map[string]any)
		extras, _ := s["extras"].(map[string]any)
		if ciel, _ := extras["ciel"].(map[string]any); ciel != nil {
			mark(ciel["cloudTexture"], ClassColor)
		}
	}
	return out
}

// textureSource returns a texture's image: its `source`, or the source of its
// KHR_texture_basisu extension.
func textureSource(v any) (int, bool) {
	t, _ := v.(map[string]any)
	if t == nil {
		return 0, false
	}
	if s, ok := entier(t["source"]); ok {
		return s, true
	}
	ext, _ := t["extensions"].(map[string]any)
	b, _ := ext[extBasisu].(map[string]any)
	return entier(b["source"])
}

// entier reads a JSON integer (numbers are kept as json.Number).
func entier(v any) (int, bool) {
	switch n := v.(type) {
	case json.Number:
		i, err := n.Int64()
		return int(i), err == nil
	case float64:
		return int(n), n == float64(int(n))
	case int:
		return n, true
	}
	return 0, false
}
