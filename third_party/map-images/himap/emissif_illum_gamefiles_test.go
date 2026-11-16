//go:build gamefiles

package himap

// LOCAL-CHANGE (infinite-theater-3d): the `illum` shader's light on real weapon materials, against
// the values Ekur's `handle_illum` exports for them (materials/<id>.json `illum_info`, `textures`).

import (
	"math"
	"path/filepath"
	"testing"
)

func TestEmissifIllumArmes(t *testing.T) {
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	mod := filepath.Join(racine, "pc", "levels", "multi", "sgh_blueprint", "sgh_blueprint-rtx-new.module")
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
	// Ekur's export for three of them: the BR75's blue strip (additive), the Plasma Pistol's
	// faint cyan (additive), the Needler's needles (opaque).
	attendus := map[uint32]struct {
		couleur [3]float32
		force   float32
		bitmap  uint32
	}{
		0x678fd324: {[3]float32{0, 0.17788847, 1}, 5, 2083911903},
		0x23698362: {[3]float32{0, 0.87136734, 1}, 0.25, 1<<32 - 1429547712}, // Ekur writes the id signed: -1429547712
		0xa348d791: {[3]float32{1, 1, 1}, 1, 1619451791},
	}
	var ids []uint32
	for id := range attendus {
		ids = append(ids, id)
	}
	table, _ := LitMateriaux(idxMat, idxGeo, ids)
	for id, a := range attendus {
		m, ok := table[id]
		if !ok || m.Shader != shaderIllum || m.Emissif == nil {
			t.Fatalf("%08x : %+v", id, m)
		}
		for k := range 3 {
			if math.Abs(float64(m.Emissif.Couleur[k]-a.couleur[k])) > 1e-5 {
				t.Fatalf("%08x couleur %v, Ekur %v", id, m.Emissif.Couleur, a.couleur)
			}
		}
		if math.Abs(float64(m.Emissif.Force-a.force)) > 1e-5 || m.Emissif.Bitmap != a.bitmap {
			t.Fatalf("%08x force %v bitmap %08x, Ekur %v %08x", id, m.Emissif.Force, m.Emissif.Bitmap, a.force, a.bitmap)
		}
	}
}
