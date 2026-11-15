// LOCAL-CHANGE (infinite-theater-3d): pins the telescoping scale rule (telescopage_forge.go).
package himap

import (
	"math"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// TestAxesFixes: an axis is fixed when every size has the same extent there (Outlook's ring
// plates: all 0.41 m thick); a single size fixes nothing.
func TestAxesFixes(t *testing.T) {
	plaque := func(x, y float64) [2][3]float64 {
		return [2][3]float64{{-x / 2, -y / 2, 0}, {x / 2, y / 2, 0.408}}
	}
	plaques := [][2][3]float64{plaque(0.8, 3.2), plaque(3.2, 3.2), plaque(12.8, 3.2), plaque(3.2, 6.4)}
	if got := axesFixes(plaques); got != [3]bool{false, false, true} {
		t.Errorf("ring plates: fixed %v, want [false false true]", got)
	}
	if got := axesFixes(plaques[:1]); got != [3]bool{} {
		t.Errorf("single size: fixed %v, want none", got)
	}
}

// TestEchelleTelescopique: a telescoping object keeps its fixed axes at 1; a static object, or
// one without a scale, is unchanged.
func TestEchelleTelescopique(t *testing.T) {
	s := mapvar.Vec3{X: 5.09, Y: 1.28, Z: 5.09}
	o := mapvar.Object{ModeForge: mapvar.ModeForgeTelescopique, Scale: &s}
	plaque := telescopage{fixes: [3]bool{false, false, true}, rapport: [3]float64{1, 1, 1}}
	got, d := echelleTelescopique(o, plaque)
	if *got.Scale != (mapvar.Vec3{X: 5.09, Y: 1.28, Z: 1}) || d != [3]float64{} {
		t.Errorf("telescoping: scale %v offset %v, want {5.09 1.28 1} and none", *got.Scale, d)
	}
	if s.Z != 5.09 {
		t.Errorf("the object's own scale was modified: %v", s)
	}
	o.ModeForge = 2
	if got, _ := echelleTelescopique(o, telescopage{fixes: [3]bool{true, true, true}}); *got.Scale != s {
		t.Errorf("static: scale %v, want %v", *got.Scale, s)
	}
	o.ModeForge, o.Scale = mapvar.ModeForgeTelescopique, nil
	if got, _ := echelleTelescopique(o, telescopage{fixes: [3]bool{true, true, true}}); got.Scale != nil {
		t.Errorf("no scale: %v, want nil", *got.Scale)
	}
}

// TestEchelleTelescopiqueReference: Outlook's I-beam 1276 (type -1722685555, reference half its
// 0.4 x 0.4 x 0.8 model, origin at one end) stores (1.332, 3.732, 10.547): it is drawn
// 0.27 x 0.75 x 4.22, centred where the model's box is centred, not 8.44 long from one end.
func TestEchelleTelescopiqueReference(t *testing.T) {
	s := mapvar.Vec3{X: 1.332, Y: 3.732, Z: 10.547}
	o := mapvar.Object{ModeForge: mapvar.ModeForgeTelescopique, Scale: &s}
	poutre := telescopage{rapport: [3]float64{0.5, 0.5, 0.5}, centre: [3]float64{0, 0, 0.4}}
	got, d := echelleTelescopique(o, poutre)
	e := [3]float64{got.Scale.X, got.Scale.Y, got.Scale.Z}
	want := [3]float64{0.666, 1.866, 5.2735}
	for a := range 3 {
		if math.Abs(e[a]-want[a]) > 1e-9 {
			t.Fatalf("scale %v, want %v", e, want)
		}
	}
	// the model's box [0, 0.8] on Z, offset then scaled, is centred on 0.4.
	lo, hi := (0+d[2])*e[2], (0.8+d[2])*e[2]
	if math.Abs((lo+hi)/2-0.4) > 1e-9 || math.Abs(hi-lo-4.2188) > 1e-9 {
		t.Errorf("Z span %.4f..%.4f, want 4.2188 long centred on 0.4", lo, hi)
	}
	if d[0] != 0 || d[1] != 0 {
		t.Errorf("offset %v on centred axes, want 0", d)
	}
}

// TestEchelleTelescopiqueOrigine: where the reference is the model (Outlook's door frames,
// 690293631, 0.406 x 1.005 x 1.605 against 0.41 x 1.00 x 1.60), the scale applies about the
// model's origin, the frame's foot: no offset, the frame stands where it is placed.
func TestEchelleTelescopiqueOrigine(t *testing.T) {
	s := mapvar.Vec3{X: 1, Y: 3.328, Z: 1.966}
	o := mapvar.Object{ModeForge: mapvar.ModeForgeTelescopique, Scale: &s}
	porte := telescopage{fixes: [3]bool{true, false, false}, rapport: [3]float64{0.99, 1.005, 1.003}, centre: [3]float64{0, 0, 0.8}}
	got, d := echelleTelescopique(o, porte)
	if d != [3]float64{} {
		t.Errorf("offset %v, want none", d)
	}
	if math.Abs(got.Scale.Z-1.966*1.003) > 1e-9 || got.Scale.X != 1 {
		t.Errorf("scale %v, want X 1 and Z stored x ratio", *got.Scale)
	}
}

// TestRapportsReference: reference over model extent per axis; 1 when the reference is unread,
// the model is flat on an axis, or the ratio is implausible.
func TestRapportsReference(t *testing.T) {
	mn, mx := [3]float64{-0.1, -0.3, 0}, [3]float64{0.1, 0.3, 0.8}
	got := rapportsReference([3]float64{0.2038, 0.4028, 0.8017}, true, mn, mx)
	want := [3]float64{1.019, 0.6713, 1.0021}
	for a := range 3 {
		if math.Abs(got[a]-want[a]) > 1e-3 {
			t.Fatalf("trim ratios %v, want %v", got, want)
		}
	}
	if got := rapportsReference([3]float64{0.2, 0.4, 0.8}, false, mn, mx); got != [3]float64{1, 1, 1} {
		t.Errorf("unread reference: %v, want 1s", got)
	}
	if got := rapportsReference([3]float64{0.2, 40, 0.8}, true, mn, [3]float64{0.1, 0.3, 0}); got[1] != 1 || got[2] != 1 {
		t.Errorf("implausible ratio or flat axis: %v, want 1 on Y and Z", got)
	}
}
