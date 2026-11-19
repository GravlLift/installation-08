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
		{MelangeAlpha, true, true, 0},
		{MelangeAlphaPremultiplie, true, true, 0},
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

// TestCoucheAlphaVitre: a layered alpha-blended material that is glass stays see-through, by
// its shader (shadersVitres) or by an in-game observation (Recharge's attic windows, 669f626c);
// one that is not (Streets' wet asphalt, 2bc7850d) draws with its layers.
func TestCoucheAlphaVitre(t *testing.T) {
	for _, c := range []struct {
		m      Materiau
		opaque bool
	}{
		{Materiau{ID: 0x2bc7850d, Shader: 0x2abae03b, Melange: MelangeAlpha, Couches: &Couches{}}, true},
		{Materiau{ID: 0x669f626c, Shader: 0x377bfad9, Melange: MelangeAlpha, Couches: &Couches{}}, false},
		{Materiau{ID: 1, Shader: 0x71ea41c5, Melange: MelangeAlpha, Couches: &Couches{}}, false},
		{Materiau{ID: 2, Melange: MelangeAlphaPremultiplie, Verre: true, Couches: &Couches{}}, false},
	} {
		if c.m.Opaque() != c.opaque {
			t.Errorf("mat %08x: opaque %v, want %v", c.m.ID, c.m.Opaque(), c.opaque)
		}
	}
}
