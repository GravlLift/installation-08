// LOCAL-CHANGE (infinite-theater-3d): the animation function curves (animation_functions.go).
package himap

import (
	"encoding/hex"
	"math"
	"testing"
)

func TestFunctionCurve(t *testing.T) {
	cases := []struct {
		name   string
		sec    string
		frames int
		k      int
		want   []float64
	}{
		// The Heatwave's weapon graph 0fca8aee, its reload_1 (11 frames): variant_switch, constant 1.
		{"constant", "010100000c000000100000000b00ffff1400000053000100000000000000803f0ad7233c0a0000770000ffff", 11, 0,
			[]float64{1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1}},
		// An IK weight (graph 981e2f16, 12 frames): 0 to frame 10, then linear to 0.2592 at frame 11.
		{"two segments", "010100000c000000100000000c00ffff140000005300020000000000a1bd043e4365873e0a0142c17742c177be3effff", 12, 0,
			[]float64{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2592}},
	}
	for _, c := range cases {
		sec, err := hex.DecodeString(c.sec)
		if err != nil {
			t.Fatal(err)
		}
		v, err := functionCurve(sec, c.k, c.frames)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if len(v) != len(c.want) {
			t.Fatalf("%s: %d values, want %d", c.name, len(v), len(c.want))
		}
		for i := range v {
			if math.Abs(v[i]-c.want[i]) > 1e-3 {
				t.Errorf("%s: frame %d = %.4f, want %.4f", c.name, i, v[i], c.want[i])
			}
		}
	}
	if _, err := functionCurve([]byte{1, 1, 0, 0}, 0, 11); err == nil {
		t.Error("a truncated section reads")
	}
}
