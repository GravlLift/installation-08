//go:build gamefiles

package himap

// LOCAL-CHANGE (infinite-theater-3d): the animated parameters of real Streets lights
// (emissif_fonctions.go), as the build writes them. Expected values were read off the tags'
// function blocks (TestSondeBlocsMateriau in sonde_emissifs_carte_research_test.go).

import (
	"encoding/json"
	"math"
	"path/filepath"
	"testing"
)

func TestAnimationsEmissivesStreets(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	mod := filepath.Join(racine, "pc", "levels", "multi", "sgh_streets", "sgh_streets-rtx-new.module")
	mats, err := CheminsMateriaux(racine, mod)
	if err != nil {
		t.Skip(err)
	}
	idxMat, err := NewModuleIndex(mats...)
	if err != nil {
		t.Skip(err)
	}
	defer idxMat.Close()
	geo, err := GeometrySearchPathMonde(racine, mod)
	if err != nil {
		t.Skip(err)
	}
	idxGeo, err := NewModuleIndex(geo...)
	if err != nil {
		t.Skip(err)
	}
	defer idxGeo.Close()
	type att struct {
		cible      string
		composante int
		onde       int
		frequence  float32
		min, max   float32 // the function's output range, divided by the still value for a force
	}
	attendus := map[uint32][]att{
		// A holographic sign: its picture slides up (offset y, slide 0.3 Hz) and its opacity
		// wanders between 0.15 and 0.4 around its still 0.3118 (0.2 Hz).
		0x03feebae: {{CibleUV, 3, 6, 0.3, 0, 1}, {CibleForce, 0, 10, 0.2, 0.4811321, 1.2830188}},
		// A magenta neon: its amount wanders between 1 and 0.333 (0.2 Hz).
		0x54a851a9: {{CibleForce, 0, 10, 0.2, 1.759288, 0.5858429}},
		// A screen: its picture slides sideways (offset x, slide 0.25 Hz).
		0x489735ef: {{CibleUV, 2, 6, 0.25, 0, 1}},
		// A screen: a small sideways wobble (cosine 1 Hz) and a flicker (jitter 0.5 Hz).
		0xc1ac0f42: {{CibleUV, 2, 2, 1, 0, 0.5}, {CibleForce, 0, 9, 0.5, 0, 1.1460674}},
		// The FREE sign: its color jitters between white and a pale blue (0.5 Hz).
		0x128751b7: {{CibleCouleur, 0, 9, 0.5, 0, 1}},
		// The NMPD hologram: its functions move its noise and scanline textures, not its emblem.
		0x05d2f6a2: nil,
		// A diffuse_emissive light driven by an object input, not time.
		0x3af7f687: nil,
		// The yellow billboard is still.
		0x8767c413: nil,
	}
	var ids []uint32
	for id := range attendus {
		ids = append(ids, id)
	}
	table, _ := LitMateriaux(idxMat, idxGeo, ids)
	for id, a := range attendus {
		m := table[id]
		if m.Emissif == nil {
			t.Fatalf("%08x : pas de lumiere (%08x)", id, m.Shader)
		}
		got := m.Emissif.Animations
		if len(got) != len(a) {
			b, _ := json.Marshal(got)
			t.Fatalf("%08x : %s, attendu %d", id, b, len(a))
		}
		for k, w := range a {
			g := got[k]
			p := g.Fonction.Periodiques
			if g.Cible != w.cible || g.Composante != w.composante || g.Periode != 1 || len(p) == 0 ||
				p[0].Onde != w.onde || math.Abs(float64(p[0].Frequence-w.frequence)) > 1e-5 ||
				math.Abs(float64(g.Fonction.Min-w.min)) > 1e-4 || math.Abs(float64(g.Fonction.Max-w.max)) > 1e-4 {
				b, _ := json.Marshal(g)
				t.Fatalf("%08x [%d] : %s, attendu %+v", id, k, b, w)
			}
		}
	}
	// The FREE sign's gradient: white, then c8d8ff in linear RGB.
	c := table[0x128751b7].Emissif.Animations[0].Couleurs
	if len(c) != 2 || c[0] != [3]float32{1, 1, 1} || math.Abs(float64(c[1][0]-0.5775805)) > 1e-4 || c[1][2] != 1 {
		t.Fatalf("degrade %v", c)
	}
}
