package himap

// LOCAL-CHANGE (infinite-theater-3d): blend-mode classification after reading the real
// `alpha blend mode` byte.

import "testing"

func TestMelangeOpaqueEtEcrit(t *testing.T) {
	cas := []struct {
		mode    ModeMelange
		couches bool
		opaque  bool
		ecrit   int
	}{
		{MelangeOpaque, false, true, 0},
		{melangeInconnuBrut, false, true, -1},
		{MelangeAdditif, true, false, 1},
		{MelangeAlpha, false, false, 3},
		{MelangeAlpha, true, false, 3},
		{MelangeAlphaPremultiplie, true, false, int(MelangeAlphaPremultiplie)},
		{melangeDecalAlpha, false, true, 0},
		{melangeDecalOpaque, false, true, 0},
		{melangeDecalAoOpaque, false, true, 0},
		{melangeDecalAoAlpha, false, true, 0},
		{29, false, false, 29}, // AccumulateAdditive
	}
	for _, c := range cas {
		m := Materiau{Melange: c.mode}
		if c.couches {
			m.Couches = &Couches{}
		}
		if m.Opaque() != c.opaque || m.melangeEcrit() != c.ecrit {
			t.Errorf("mode %d : opaque %v ecrit %d, want %v %d", c.mode, m.Opaque(), m.melangeEcrit(), c.opaque, c.ecrit)
		}
	}
}
