//go:build gamefiles

package himap

// LOCAL-CHANGE (infinite-theater-3d): the Ravager's and the Disruptor's materials are NOT
// self-lit. Read on the game's own parameters: all twelve weapon materials (plus the six shared
// arm materials of the first-person rigs) are opaque layered hard-surface materials whose shaders
// (4dac018a, a12c98fe) declare no emissive parameter, whose postprocess constants carry no
// emissive value (their only non-default values, 255/255 at 1184/1192 of 4dac018a and 2/0.25/1 of
// the style block, are shared by every material of the shader, glow weapons included), and which
// Ekur's export classifies as Layered/Opaque with no illum_info. The glow the game shows on these
// weapons is not a material emission: the bright parts are baked in the diffuse maps (the engine's
// bloom does the rest) and the plasma effects are particles, outside the weapon model. This test
// pins the reading so a future change does not light what the game does not.

import (
	"path/filepath"
	"testing"
)

func TestEmissifRavagerDisruptor(t *testing.T) {
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
	// Ravager (c30d87c7) body, Disruptor (84bd29ed) body, and the arms of the first-person rigs.
	cases := []struct {
		id     uint32
		arme   string
		shader uint32
	}{
		{0x2f9eeeed, "Ravager", 0x4dac018a}, {0x4b6f73e2, "Ravager", 0x4dac018a},
		{0x5ded932d, "Ravager", 0x4dac018a}, {0x63878fae, "Ravager", 0x4dac018a},
		{0x857ed5e1, "Ravager", 0x4dac018a}, {0xaaa17a85, "Ravager", 0x4dac018a},
		{0xd35782ee, "Ravager", 0x4dac018a},
		{0x02a2fcfc, "Disruptor", 0xa12c98fe}, {0x17faa3c1, "Disruptor", 0xa12c98fe},
		{0xb7dd47d8, "Disruptor", 0xa12c98fe}, {0xd134a252, "Disruptor", 0xa12c98fe},
		{0xfe0aded5, "Disruptor", 0xa12c98fe},
		{0x0b162dfe, "bras", 0xa12c98fe}, {0x342c4479, "bras", 0xa12c98fe},
		{0x37a02725, "bras", 0xa12c98fe}, {0xaad3d155, "bras", 0xa12c98fe},
		{0xe5007535, "bras", 0xa12c98fe}, {0xff9c72fa, "bras", 0xa12c98fe},
	}
	var ids []uint32
	for _, c := range cases {
		ids = append(ids, c.id)
	}
	table, illisibles := LitMateriaux(idxMat, idxGeo, ids)
	if illisibles != 0 {
		t.Fatalf("%d materiaux illisibles", illisibles)
	}
	for _, c := range cases {
		m, ok := table[c.id]
		if !ok {
			t.Fatalf("%s %08x : absent de la table", c.arme, c.id)
		}
		if m.Shader != c.shader {
			t.Fatalf("%s %08x : shader %08x, attendu %08x", c.arme, c.id, m.Shader, c.shader)
		}
		if m.Emissif != nil {
			t.Fatalf("%s %08x : emet %v, le jeu ne l'allume pas", c.arme, c.id, m.Emissif)
		}
		if m.Surface == nil {
			t.Fatalf("%s %08x : pas de surface dure, lu %+v", c.arme, c.id, m)
		}
	}
}
