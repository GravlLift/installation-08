package meshbuild

import (
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// TestForgeSun: the variant's Sunlight intensity always, its color override only when switched
// on, resolved in the Forge color list and scaled to a peak of 1.
func TestForgeSun(t *testing.T) {
	catalog := []byte(`{"colors":[[1,1,1],[0.5,0.25,0.125]]}`)
	i := 25.0
	got, color, err := forgeSun(&mapvar.Lighting{SunIntensity: &i, SunColorIndex: 1, SunColorSwitch: mapvar.SunColorOverrideOn}, catalog)
	if err != nil || got == nil || *got != 25 || color == nil || *color != [3]float64{1, 0.5, 0.25} {
		t.Fatalf("sun %v %v %v", got, color, err)
	}
	if _, color, _ := forgeSun(&mapvar.Lighting{SunColorIndex: 1, SunColorSwitch: 2}, catalog); color != nil {
		t.Fatalf("switched-off override applied: %v", color)
	}
	if _, color, _ := forgeSun(&mapvar.Lighting{SunColorIndex: 9, SunColorSwitch: mapvar.SunColorOverrideOn}, catalog); color != nil {
		t.Fatalf("out-of-range color applied: %v", color)
	}
	if i, c, err := forgeSun(nil, catalog); i != nil || c != nil || err != nil {
		t.Fatal("nil lighting overrode the sun")
	}
}
