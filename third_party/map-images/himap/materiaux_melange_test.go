package himap

// LOCAL-CHANGE (infinite-theater-3d): blend-mode classification after reading the real
// `alpha blend mode` byte.

import "testing"

func TestMelangeOpaqueEtEcrit(t *testing.T) {
	cas := []struct {
		mode   ModeMelange
		opaque bool
		ecrit  int
	}{
		{MelangeOpaque, true, 0},
		{melangeInconnuBrut, true, -1},
		{MelangeAdditif, false, 1},
		{MelangeAlpha, false, 3},
		{melangeDecalAlpha, true, 0},
		{melangeDecalOpaque, true, 0},
		{melangeDecalAoOpaque, true, 0},
		{melangeDecalAoAlpha, true, 0},
		{29, false, 29}, // AccumulateAdditive
	}
	for _, c := range cas {
		m := Materiau{Melange: c.mode}
		if m.Opaque() != c.opaque || m.melangeEcrit() != c.ecrit {
			t.Errorf("mode %d : opaque %v ecrit %d, want %v %d", c.mode, m.Opaque(), m.melangeEcrit(), c.opaque, c.ecrit)
		}
	}
}
