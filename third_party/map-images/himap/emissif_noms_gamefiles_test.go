//go:build gamefiles

package himap

// LOCAL-CHANGE (infinite-theater-3d): the lights read by parameter names (formesEmissives) on real
// Streets materials. Expected values are the constants at the bytes the shaders declare for those
// names, dumped by sonde_emissifs_carte_research_test.go (TestSondeEmissifsCarte).

import (
	"math"
	"path/filepath"
	"testing"
)

func TestEmissifParNomsStreets(t *testing.T) {
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
	attendus := map[uint32]struct {
		shader  uint32
		melange ModeMelange
		couleur [3]float32
		force   float32
		bitmap  uint32
		image   bool
	}{
		// The yellow billboard by the plaza (holographic sign: color_tint, intensity 5 x opacity 1).
		0x8767c413: {0x6eb5a1b6, MelangeAdditif, [3]float32{1, 0.6444799, 0.52711535}, 5, 0x96380e41, true},
		// The NMPD sign (intensity 100 x opacity 0.5909).
		0xcaf57c0a: {0x6eb5a1b6, MelangeAdditif, [3]float32{0.008023192, 0.02415763, 0.11443538}, 100 * 0.59090906, 0x41214d07, true},
		// The small FREE sign (maximum blend).
		0x128751b7: {0x6eb5a1b6, MelangeMaximum, [3]float32{0.6852561, 0.76654994, 1}, 2, 0x6e7e13ce, true},
		// The NMPD hologram above the box in the square (projector: base_tint x 2.013 x 1).
		0x05d2f6a2: {0x0dfb07c3, MelangeAdditif, [3]float32{0.046665095, 0.23839766, 0.57758063}, 2.012987, 0x41214d07, true},
		// A magenta neon (base_emissive, detail mask).
		0x311a6737: {0xfa04e237, MelangeOpaque, [3]float32{0.7454045, 0.017641952, 0.7454045}, 120, 0xdcff9478, false},
		// A warm light strip of the MMTA station.
		0xceaa51ca: {0x14f680a0, MelangeOpaque, [3]float32{0.9646866, 0.57758063, 0.27467737}, 20, 0xec18d5b4, false},
		// A screen panel (base_emissive_color_tint, intensity 30 x amount 2).
		0x0880cc7f: {0x170fd0e8, MelangeOpaque, [3]float32{0.15292618, 0.15292618, 0.15292618}, 60, 0xd2d1306b, true},
		// A surface shader with the emissive_* block (no amount declared).
		0xda789683: {0x18d8a691, MelangeOpaque, [3]float32{0.25015837, 0.2086369, 0.057805434}, 5.24156, 0xa24d67a8, false},
	}
	var ids []uint32
	for id := range attendus {
		ids = append(ids, id)
	}
	table, _ := LitMateriaux(idxMat, idxGeo, ids)
	for id, a := range attendus {
		m, ok := table[id]
		if !ok || m.Shader != a.shader || m.Melange != a.melange || m.Emissif == nil {
			t.Fatalf("%08x : %+v", id, m)
		}
		e := m.Emissif
		for k := range 3 {
			if math.Abs(float64(e.Couleur[k]-a.couleur[k])) > 1e-5 {
				t.Fatalf("%08x couleur %v, attendu %v", id, e.Couleur, a.couleur)
			}
		}
		if math.Abs(float64(e.Force-a.force)) > 1e-3 || e.Bitmap != a.bitmap || e.Image != a.image || e.Transfo == nil {
			t.Fatalf("%08x force %v bitmap %08x image %v transfo %v, attendu %v %08x %v", id, e.Force, e.Bitmap, e.Image, e.Transfo, a.force, a.bitmap, a.image)
		}
		t.Logf("%08x transfo %+v", id, *e.Transfo)
	}
	// A dark one: 18d8a691 at intensity 0 has no light.
	dark, _ := LitMateriaux(idxMat, idxGeo, []uint32{0x46338913})
	if m, ok := dark[0x46338913]; !ok || m.Emissif != nil {
		t.Fatalf("46338913 (emissive_intensity 0) : %+v", m)
	}
}
