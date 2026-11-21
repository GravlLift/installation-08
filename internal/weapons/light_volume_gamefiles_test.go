// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package weapons

import (
	"math"
	"testing"
)

// The equipment pad's upward cone (`efge` 48e03d70): two light volume generators.
func TestPadConeLightVolumes(t *testing.T) {
	geo, _ := padIndexes(t)
	raw, err := geo.Extract(0x48e03d70)
	if err != nil {
		t.Fatal(err)
	}
	vols, err := readLightVolumes(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(vols) != 2 {
		t.Fatalf("%d generators", len(vols))
	}
	near := func(a, b float32) bool { return math.Abs(float64(a-b)) < 1e-4 }
	constant := func(p GeneratorProperty) float32 {
		if p.Constant == nil {
			t.Fatalf("not a constant: %+v", p)
		}
		return *p.Constant
	}
	v := vols[0]
	if v.MaxCount != 32 || !near(constant(v.Length), 0.3) || !near(constant(v.ProfileLength), 0.2) || !near(constant(v.ProfileDensity), 30) || !near(constant(v.ProfileAlpha), 0.4) {
		t.Errorf("cone constants %+v", v)
	}
	th := v.ProfileThickness
	if th.Input != "profilePosition" || th.Curve == nil || !near(th.Curve.RangeMin, 0.15) || !near(th.Curve.RangeMax, 0.45) || th.Curve.Segments[0].Kind != "linear" {
		t.Errorf("thickness %+v", th)
	}
	in := v.ProfileIntensity
	if in.Input != "profilePosition" || in.Curve == nil || !near(in.Curve.RangeMin, 1) || !near(in.Curve.RangeMax, 0) {
		t.Errorf("intensity %+v", in)
	}
	c := v.ProfileColor
	if c.Input != "systemAge" || c.Curve == nil || c.From != [3]float32{0, 0, 0} || !near(c.To[0], 0.033104774) || !near(c.To[1], 0.30946895) || !near(c.To[2], 0.43965724) {
		t.Errorf("color %+v", c)
	}
	if !v.Additive || v.CenterOffset != 1 || v.VolumeFalloff != 2 || v.FarFade != [2]float32{40, 50} {
		t.Errorf("shading %+v", v)
	}
	if w := vols[1]; !near(constant(w.ProfileDensity), 5) || w.ProfileColor.Input != "profilePosition" {
		t.Errorf("second generator %+v", w)
	}
}
