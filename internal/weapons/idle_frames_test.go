package weapons

import (
	"math"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

func TestMarkerFrame(t *testing.T) {
	// The Heatwave's right fin marker (2ac9c2ff, node 0): a quarter turn about Halo up (z), which is
	// GLB up (y).
	s := math.Sqrt2 / 2
	rot := [9]float64{0, -1, 0, 1, 0, 0, 0, 0, 1} // row-major, +90 degrees about z
	p, q := markerFrame(himap.Transforme{Scale: 1, Rot: rot, Trans: [3]float64{0.0574, 0.0133, 0.0101}})
	if want := [3]float64{0.0574, 0.0101, -0.0133}; p != want {
		t.Errorf("position %v, want %v", p, want)
	}
	want := [4]float64{0, s, 0, s}
	for k := range q {
		if math.Abs(q[k]-want[k]) > 1e-4 {
			t.Fatalf("rotation %v, want %v", q, want)
		}
	}
	// Halo forward (+x) turned to Halo left (+y), i.e. GLB -z: the quaternion turns GLB +x to -z.
	x, z := 1-2*(q[1]*q[1]+q[2]*q[2]), 2*(q[0]*q[2]-q[3]*q[1])
	if math.Abs(x) > 1e-4 || math.Abs(z+1) > 1e-4 {
		t.Errorf("GLB +x goes to (%.3f, _, %.3f), want (0, _, -1)", x, z)
	}
	if _, q := markerFrame(himap.TransformeIdentite()); q != [4]float64{0, 0, 0, 1} {
		t.Errorf("identity rotation %v", q)
	}
}
