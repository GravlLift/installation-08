package himap

import (
	"encoding/binary"
	"testing"
)

// instanceDe: an instance of geometry `rtgo` carrying `mats`.
func instanceDe(rtgo uint32, mats ...uint32) Instance {
	var in Instance
	binary.LittleEndian.PutUint32(in.MeshRef[refOffGlobalID:], rtgo)
	in.Materiaux = mats
	return in
}

// TestVitreSombreRecharge (LOCAL-CHANGE (infinite-theater-3d)): Recharge's roof pane (rtgo
// 1a27c1cf) and its long hall windows (rtgo 43ec8b62) share the glass 0x4faa9c4f. The pane is
// written as a dark opaque material, the windows stay glass. The pane is no longer listed
// (2026-11-18), so the test lists it for its own run.
func TestVitreSombreRecharge(t *testing.T) {
	const verre, toit, fenetres = 0x4faa9c4f, 0x1a27c1cf, 0x43ec8b62
	if _, listed := vitresSombresConstatees[toit]; listed {
		t.Fatal("Recharge's roof pane must stay clear glass")
	}
	vitresSombresConstatees[toit] = [3]float32{0.05, 0.05, 0.05}
	defer delete(vitresSombresConstatees, toit)
	m := &MaillageMonde{Materiaux: map[uint32]Materiau{verre: {ID: verre, Shader: 0x71ea41c5, Melange: MelangeAlpha}}}
	pane := m.assombrit(instanceDe(toit, verre))
	window := m.assombrit(instanceDe(fenetres, verre))
	if window.Materiaux[0] != verre {
		t.Fatalf("windows: material %08x, want the glass", window.Materiaux[0])
	}
	sombre := pane.Materiaux[0]
	if sombre == verre || m.surfacesSombres[sombre].Source != verre {
		t.Fatalf("pane: material %08x, stand-ins %v", sombre, m.surfacesSombres)
	}
	if again := m.assombrit(instanceDe(toit, verre)); again.Materiaux[0] != sombre || len(m.surfacesSombres) != 1 {
		t.Fatalf("a second pane instance gets %08x, %d stand-ins", again.Materiaux[0], len(m.surfacesSombres))
	}

	tri := []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}
	m.Structure = GroupeMaillage{Sommets: append(append([]float32{}, tri...), tri...),
		Indices: map[uint32][]uint32{verre: {0, 1, 2}, sombre: {3, 4, 5}}}
	doc, _, err := documentGLB(m, "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	parNom := map[string]gltfMaterial{}
	for _, g := range doc.Materials {
		parNom[g.Name] = g
	}
	g := parNom["mat_4faa9c4f"]
	if g.AlphaMode != "BLEND" || g.Extras["vitre"] != true {
		t.Errorf("windows' glass: alpha %s extras %v", g.AlphaMode, g.Extras)
	}
	var p gltfMaterial
	for _, c := range doc.Materials {
		if c.Extras["vitreSombre"] == uint32(verre) {
			p = c
		}
	}
	if p.AlphaMode != "OPAQUE" || !p.DoubleSided || p.Extras["vitre"] != nil || p.Extras["melange"] != 0 || p.Extras["teinte"] == nil {
		t.Errorf("pane: %+v", p)
	}
	if c := p.PBR.BaseColorFactor; c[0] <= 0 || c[0] > 0.1 || c[3] != 1 {
		t.Errorf("pane color %v, want a dark grey", c)
	}
}
