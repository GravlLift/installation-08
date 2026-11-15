package himap

import (
	"encoding/json"
	"fmt"
	"math"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// TeinteForge porte la couleur linéaire et les facteurs du matériau Forge.
type TeinteForge struct {
	Couleur         [3]float32
	Rugosite, Metal float32
}
type materiauTeinte struct {
	source uint32
	teinte TeinteForge
}

// LitMateriauxForge résout la première couche de chaque style dans la bibliothèque fournie.
func LitMateriauxForge(data []byte, styles map[int32][]mapvar.StyleLayer) (map[int32]TeinteForge, error) {
	var doc struct {
		Layers map[string]struct {
			Name  int32 `json:"name"`
			Layer struct {
				Mid       []float32 `json:"mid_color"`
				Roughness *float32  `json:"roughness"`
				Metallic  *float32  `json:"metallic"`
			} `json:"layer"`
		} `json:"layers"`
	}
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("matériaux Forge : %w", err)
	}
	if doc.Layers == nil {
		return nil, fmt.Errorf("matériaux Forge : couches absentes")
	}
	bibli := map[int32]TeinteForge{}
	for _, entry := range doc.Layers {
		l := entry.Layer
		if len(l.Mid) != 3 {
			continue
		}
		t := TeinteForge{Couleur: [3]float32{l.Mid[0], l.Mid[1], l.Mid[2]}, Rugosite: 1}
		if l.Roughness != nil {
			t.Rugosite = max(0, min(1, *l.Roughness))
		}
		if l.Metallic != nil {
			t.Metal = max(0, min(1, *l.Metallic))
		}
		bibli[entry.Name] = t
	}
	out := map[int32]TeinteForge{}
	for id, layers := range styles {
		if len(layers) == 0 {
			continue
		}
		l := layers[0]
		t, ok := bibli[l.Hash]
		if !ok {
			continue
		}
		if l.Tint != nil && l.Scalar > 0 {
			t.Couleur[0] *= float32(l.Tint.X)
			t.Couleur[1] *= float32(l.Tint.Y)
			t.Couleur[2] *= float32(l.Tint.Z)
		}
		for i, c := range t.Couleur {
			t.Couleur[i] = float32(math.Round(float64(max(0, min(1, c)))*64) / 64)
		}
		out[id] = t
	}
	return out, nil
}
