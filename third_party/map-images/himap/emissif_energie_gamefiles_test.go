//go:build gamefiles

package himap

// LOCAL-CHANGE (infinite-theater-3d): the energy shader's light on the Sentinel Beam's real
// energy materials (third and first person alike): intensity read at its declared
// `emissive_intensity` (+92), color in its one-pixel tint map (slot 68).

import (
	"math"
	"path/filepath"
	"testing"
)

func TestEmissifEnergieSentinelle(t *testing.T) {
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
	// The Sentinel Beam's (a0955e9e) five energy materials, third and first person alike.
	sentinelle := []uint32{0xcfb8bdd0, 0xd9c82c10, 0xbe1f4022, 0xd9f60cff, 0x5de9ab0e}
	var ids []uint32
	for _, id := range sentinelle {
		ids = append(ids, id)
	}
	table, _ := LitMateriaux(idxMat, idxGeo, ids)
	const teinte = uint32(0x2756)
	for _, id := range sentinelle {
		m, ok := table[id]
		if !ok || m.Shader != shaderEnergie || m.Emissif == nil {
			t.Fatalf("%08x : %+v", id, m)
		}
		if m.Emissif.Couleur != [3]float32{1, 1, 1} {
			t.Fatalf("%08x couleur : %v", id, m.Emissif.Couleur)
		}
		if math.Abs(float64(m.Emissif.Force-20)) > 1e-5 || m.Emissif.Bitmap != teinte {
			t.Fatalf("%08x force %v bitmap %08x", id, m.Emissif.Force, m.Emissif.Bitmap)
		}
	}
	// The tint map is the color the game shows: a one-pixel olive texture.
	tex, err := LitBitmap(idxGeo, teinte, 256)
	if err != nil {
		t.Skipf("texture %08x : %v", teinte, err)
	}
	p := tex.Image.NRGBAAt(0, 0)
	if p.R != 128 || p.G != 128 || p.B != 0 {
		t.Fatalf("pixel de teinte : %d %d %d", p.R, p.G, p.B)
	}
}
