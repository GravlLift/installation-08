package himap

import (
	"math"
	"testing"
)

func proche32(a, b float32) bool { return math.Abs(float64(a-b)) < 1e-3 }

func TestDemiFlottantLitLesConstantesDesProgrammes(t *testing.T) {
	for h, want := range map[uint16]float32{0x3c00: 1, 0x3800: 0.5, 0x3266: 0.2, 0x38cd: 0.6, 0x3d00: 1.25, 0x0000: 0, 0xbc00: -1} {
		if got := demiFlottant(h); !proche32(got, want) {
			t.Errorf("demiFlottant(%#x) = %v, want %v", h, got, want)
		}
	}
}

// A program from Live Fire: band(slot 0; 0.2..0.6, fade 0.2 each side).
func TestEvalueProgrammeBande(t *testing.T) {
	prog := []uint32{0x01000004, 0x0a003266, 0x0a0038cd, 0x0a003266, 0x0a003266, 0x17000000}
	for x, want := range map[float32]float32{0: 0, 0.1: 0.5, 0.4: 1, 0.7: 0.5, 0.9: 0} {
		got, ok := evalueProgramme(prog, func(slot int) float32 {
			if slot != 0 {
				t.Fatalf("slot %d read, want 0", slot)
			}
			return x
		})
		if !ok || !proche32(got, want) {
			t.Errorf("x=%v: %v %v, want %v", x, got, ok, want)
		}
	}
}

// (1 - 0.6 * slot0) * band(slot1), the shape of Live Fire's masked layers; slot1 is register
// 4's green channel.
func TestEvalueProgrammeMultiplieEtInverse(t *testing.T) {
	prog := []uint32{0x01000004, 0x0a0038cd, 0x0d000000, 0x12000000, 0x02000004, 0x0a003266, 0x0a0038cd, 0x0a003266, 0x0a003266, 0x17000000, 0x0d000000}
	got, ok := evalueProgramme(prog, func(slot int) float32 { return []float32{0.5, 0.4}[slot] })
	if !ok || !proche32(got, 0.7) {
		t.Fatalf("got %v %v, want 0.7", got, ok)
	}
}

func TestEvalueProgrammeLerpSmoothstepEtRegistres(t *testing.T) {
	// lerp(0.5, 1, slot4) * smoothstep(0.5, 1, slot6): register 5 starts at slot 4, register 6 at 6.
	prog := []uint32{0x0a003800, 0x0a003c00, 0x01000005, 0x19000000, 0x0a003800, 0x0a003c00, 0x01000006, 0x14000000, 0x0d000000}
	got, ok := evalueProgramme(prog, func(slot int) float32 { return map[int]float32{4: 1, 6: 0.75}[slot] })
	if !ok || !proche32(got, 0.5) {
		t.Fatalf("got %v %v, want 0.5", got, ok)
	}
}

func TestEvalueProgrammeRefuseLeMalForme(t *testing.T) {
	lit := func(int) float32 { return 1 }
	for _, prog := range [][]uint32{{0x99000000}, {0x0d000000}, {0x0a003c00, 0x0a003c00}, {0x01000009}, {0x03000005}} {
		if _, ok := evalueProgramme(prog, lit); ok {
			t.Errorf("%x accepted", prog)
		}
	}
	if got, ok := evalueProgramme([]uint32{0x0a003d00}, lit); !ok || got != 1 {
		t.Errorf("result not clamped: %v %v", got, ok)
	}
}

func TestMasqueSequentielRendLesPoidsNormalises(t *testing.T) {
	g := [terrainGroupesMax]float32{0.4, 0.3, 0.2, 0.1}
	m := masqueSequentiel(g)
	// Replay the viewer's blend: start on group 1, mix toward k by m[k-1].
	parts := [terrainGroupesMax]float32{1}
	for k := 1; k < terrainGroupesMax; k++ {
		for j := 0; j < k; j++ {
			parts[j] *= 1 - m[k-1]
		}
		parts[k] = m[k-1]
	}
	for k := range g {
		if !proche32(parts[k], g[k]) {
			t.Fatalf("group %d weight %v, want %v (mask %v)", k, parts[k], g[k], m)
		}
	}
}

func TestGroupesPaletteRegroupeParCouleur(t *testing.T) {
	aire := []float64{10, 50, 5, 30, 1, 0}
	couleur := [][3]float32{{0.1, 0.2, 0}, {0.3, 0.2, 0.1}, {0.11, 0.2, 0}, {0.5, 0.5, 0.5}, {0.3, 0.21, 0.1}, {0, 0, 1}}
	groupe, reps := groupesPalette(aire, couleur)
	if len(reps) != 3 || reps[0] != 1 || reps[1] != 3 || reps[2] != 0 {
		t.Fatalf("reps %v", reps)
	}
	want := []int{2, 0, 2, 1, 0}
	for i, g := range want {
		if groupe[i] != g {
			t.Errorf("entry %d in group %d, want %d", i, groupe[i], g)
		}
	}
}
