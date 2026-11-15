// LOCAL-CHANGE (infinite-theater-3d): pins the telescoping scale rule (telescopage_forge.go).
package himap

import (
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
	got := echelleTelescopique(o, [3]bool{false, false, true})
	if *got.Scale != (mapvar.Vec3{X: 5.09, Y: 1.28, Z: 1}) {
		t.Errorf("telescoping: scale %v, want {5.09 1.28 1}", *got.Scale)
	}
	if s.Z != 5.09 {
		t.Errorf("the object's own scale was modified: %v", s)
	}
	o.ModeForge = 2
	if got := echelleTelescopique(o, [3]bool{true, true, true}); *got.Scale != s {
		t.Errorf("static: scale %v, want %v", *got.Scale, s)
	}
	o.ModeForge, o.Scale = mapvar.ModeForgeTelescopique, nil
	if got := echelleTelescopique(o, [3]bool{true, true, true}); got.Scale != nil {
		t.Errorf("no scale: %v, want nil", *got.Scale)
	}
}
