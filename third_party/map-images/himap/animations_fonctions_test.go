// LOCAL-CHANGE (infinite-theater-3d): the animation function curves (animations_fonctions.go).
package himap

import (
	"encoding/hex"
	"math"
	"testing"
)

func TestCourbeDeFonction(t *testing.T) {
	cas := []struct {
		nom    string
		sec    string
		images int
		k      int
		veut   []float64
	}{
		// The Heatwave's weapon graph 0fca8aee, its reload_1 (11 frames): variant_switch, constant 1.
		{"constante", "010100000c000000100000000b00ffff1400000053000100000000000000803f0ad7233c0a0000770000ffff", 11, 0,
			[]float64{1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1}},
		// An IK weight (graph 981e2f16, 12 frames): 0 to frame 10, then linear to 0.2592 at frame 11.
		{"deux segments", "010100000c000000100000000c00ffff140000005300020000000000a1bd043e4365873e0a0142c17742c177be3effff", 12, 0,
			[]float64{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2592}},
	}
	for _, c := range cas {
		sec, err := hex.DecodeString(c.sec)
		if err != nil {
			t.Fatal(err)
		}
		v, err := courbeDeFonction(sec, c.k, c.images)
		if err != nil {
			t.Fatalf("%s: %v", c.nom, err)
		}
		if len(v) != len(c.veut) {
			t.Fatalf("%s: %d valeurs, %d attendues", c.nom, len(v), len(c.veut))
		}
		for i := range v {
			if math.Abs(v[i]-c.veut[i]) > 1e-3 {
				t.Errorf("%s: image %d = %.4f, attendu %.4f", c.nom, i, v[i], c.veut[i])
			}
		}
	}
	if _, err := courbeDeFonction([]byte{1, 1, 0, 0}, 0, 11); err == nil {
		t.Error("une section tronquee se lit")
	}
}
