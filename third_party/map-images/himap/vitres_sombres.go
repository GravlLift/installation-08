// Package himap — vitres_sombres.go (LOCAL-CHANGE (infinite-theater-3d)): glass panes the game
// shows dark, drawn as a dark opaque surface.
//
// A glass material reads as glass where it faces bright surroundings and as a dark ceiling
// where its reflection is a dark interior (inferred: the glass shader 71ea41c5 blends at its own
// opacity, 0.33 on Recharge, with a reflection cubemap). The view draws every glass as the same
// clear placeholder, so such a pane shows the sky. The material cannot carry the exception: the
// same `mat ` draws both kinds (Recharge's 0x4faa9c4f is the long hall's windows and the roof
// over the batteries). The exception is keyed by the geometry (`rtgo`) of the pane.
//
// Each entry is an in-game observation, like vitresConstatees, never a deduction.
package himap

import "fmt"

// vitresSombresConstatees: rtgo GlobalID -> the linear color the pane is drawn with.
var vitresSombresConstatees = map[uint32][3]float32{
	// Recharge: the roof pane over the batteries' girder lattice (bsp instance 651, glass
	// 0x4faa9c4f). In game, dark grey through every gap of the lattice (user screenshot,
	// 2026-11-15). The long hall's windows (rtgo 43ec8b62, same material) stay glass.
	0x1a27c1cf: {0.05, 0.05, 0.05},
}

// surfaceSombre: the GLB material standing in for a pane's glass.
type surfaceSombre struct {
	// Source is the glass material the pane carries in the game.
	Source  uint32
	Couleur [3]float32
}

// assombrit returns the instance with its materials replaced by dark opaque stand-ins when its
// geometry is a dark pane (vitresSombresConstatees), unchanged otherwise. A stand-in GlobalID is
// allocated downward from 0xFFFFFFFE, one per (source material, color).
func (m *MaillageMonde) assombrit(in Instance) Instance {
	couleur, ok := vitresSombresConstatees[in.RuntimeGeoID()]
	if !ok {
		return in
	}
	if m.surfacesSombres == nil {
		m.surfacesSombres = map[uint32]surfaceSombre{}
	}
	mats := make([]uint32, len(in.Materiaux))
	for k, source := range in.Materiaux {
		mats[k] = m.idSombre(surfaceSombre{Source: source, Couleur: couleur})
	}
	in.Materiaux = mats
	return in
}

func (m *MaillageMonde) idSombre(s surfaceSombre) uint32 {
	for id, deja := range m.surfacesSombres {
		if deja == s {
			return id
		}
	}
	id := ^uint32(0) - 1 - uint32(len(m.surfacesSombres))
	m.surfacesSombres[id] = s
	return id
}

// surfaceSombreGLTF: an opaque, untextured material of the pane's color. `extras.vitreSombre`
// names the game's glass material for the surface inspector.
func surfaceSombreGLTF(id uint32, s surfaceSombre) gltfMaterial {
	return gltfMaterial{
		Name: fmt.Sprintf("mat_%08x", id), AlphaMode: "OPAQUE", DoubleSided: true,
		PBR: gltfPBR{BaseColorFactor: [4]float32{s.Couleur[0], s.Couleur[1], s.Couleur[2], 1}, RoughnessFactor: 0.9},
		Extras: map[string]any{
			"id": id, "connu": true, "melange": 0, "teinte": s.Couleur, "vitreSombre": s.Source,
		},
	}
}
