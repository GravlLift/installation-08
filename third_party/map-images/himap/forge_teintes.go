package himap

import (
	"encoding/json"
	"fmt"
	"math"
	"slices"

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
type plageForge struct {
	source     uint32
	debut, fin int
	teinte     TeinteForge
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

// appliqueTeintes sépare les indices des placements dont le matériau n'a aucune couche publiée.
func (m *MaillageMonde) appliqueTeintes() {
	if len(m.plagesForge) == 0 {
		return
	}
	groupes := map[uint32][]plageForge{}
	for _, p := range m.plagesForge {
		groupes[p.source] = append(groupes[p.source], p)
	}
	reserves := map[uint32]bool{}
	for _, g := range []*GroupeMaillage{&m.Structure, &m.Decor, &m.Ombre} {
		for id := range g.Indices {
			reserves[id] = true
		}
	}
	type cle struct {
		source uint32
		teinte TeinteForge
	}
	ids := map[cle]uint32{}
	m.teintesForge = map[uint32]materiauTeinte{}
	prochain := ^uint32(0)
	sources := make([]uint32, 0, len(groupes))
	for source := range groupes {
		sources = append(sources, source)
	}
	slices.Sort(sources) // ordre stable : deux exports de la même variante rendent le même fichier
	for _, source := range sources {
		plages := groupes[source]
		mat := m.Materiaux[source]
		couche := false
		if mat.Couches != nil && mat.Opaque() {
			for _, c := range mat.Couches.Couches {
				if _, ok := m.TexturesCouches[c.Bitmap]; ok {
					couche = true
					break
				}
			}
		}
		if couche {
			continue
		}
		original := m.Structure.Indices[source]
		garde := 0
		position := 0
		for _, p := range plages {
			garde += copy(original[garde:], original[position:p.debut])
			key := cle{source, p.teinte}
			id, ok := ids[key]
			if !ok {
				for reserves[prochain] {
					prochain--
				}
				id = prochain
				reserves[id] = true
				prochain--
				ids[key] = id
				m.teintesForge[id] = materiauTeinte{source, p.teinte}
			}
			m.Structure.Indices[id] = append(m.Structure.Indices[id], original[p.debut:p.fin]...)
			position = p.fin
		}
		garde += copy(original[garde:], original[position:])
		m.Structure.Indices[source] = original[:garde]
	}
	m.plagesForge = nil
}
