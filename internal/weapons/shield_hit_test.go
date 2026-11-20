// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weapons

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

// hitConstants builds a generator $Globals laid out as the shield impact generator's (efge
// 70e04608, read 2026-11-19): every word the decoder reads, at its offset.
func hitConstants() []byte {
	c := make([]byte, generatorConstantsSize)
	f := func(off int, v float32) { binary.LittleEndian.PutUint32(c[off:], math.Float32bits(v)) }
	u := func(off int, v uint32) { binary.LittleEndian.PutUint32(c[off:], v) }
	u(0, 21)                    // shared_size_in_dwords
	u(112, 3)                   // hitColorOverrideMode
	const constant = 0x4A000000 // y of a constant property: 2097152.0, bit 21 of its uint
	for _, off := range []int{144, 160, 176, 192, 224, 272} {
		u(off+4, constant)
	}
	f(208, 0.005) // extrusionDistanceProperty
	u(208+4, constant)
	u(240+12, 0x49200000) // hitIntensity: w = 655360.0, input 5 (impactTime)
	u(256+8, 0x48800000)  // hitRadiusProperty: z = 262144.0 (function 2)
	u(256+12, 0x49200000) // input 5
	f(288, 1)
	f(308, 0.75)
	f(312, 19.999996)
	f(316, -1.4285715)
	f(340, 1)
	f(344, 1)
	f(356, 1)
	f(360, 1)
	f(364, 1)
	f(368, 1)
	f(380, 1)
	f(384, 1)
	f(388, 2)
	f(392, 0.1)
	f(396, 0)
	f(400, 1)
	f(412, 0.75)
	f(416, -1.4285715)
	f(420, 19.999996)
	f(444, 1)
	return c
}

// hitProperties builds the shield impact generator's property buffer (cbPropertiesConstants, read
// from efge 70e04608 on 2026-11-19): function 0, the hit intensity (90 -> 0), a linear then a cubic
// segment; function 2, the hit radius (0.1 -> 0.05), likewise.
func hitProperties() []byte {
	regs := [][4]float32{
		{0, 0, 0, 0},
		{4, 0.10333333, 90, 0}, {52, 0.001, 0.002, 0}, {7.6451616, 0, 0, 0}, {0, 0, 0, 0},
		{7, math.MaxFloat32, 0, 0}, {0, 0, 0, 0}, {0.49895266, -1.3106544, 1.1244504, 0.68725115}, {0, 0, 0, 0},
		{4, 0.6983333, 0.1, 0.05}, {52, 0.001, 0.002, 0}, {0.13842481, 0, 0, 0}, {0, 0, 0, 0},
		{7, math.MaxFloat32, 0, 0}, {0, 0, 0, 0}, {-1.8765619, -4.862851, 15.355386, -7.615974}, {0, 0, 0, 0},
	}
	b := make([]byte, len(regs)*16)
	for i, r := range regs {
		for k, v := range r {
			binary.LittleEndian.PutUint32(b[i*16+k*4:], math.Float32bits(v))
		}
	}
	return b
}

// curveAt evaluates a curve as the compute shader does (the view's `evalCurve` mirrors it).
func curveAt(c *GeneratorCurve, input float64) float64 {
	x := math.Min(1, math.Max(0, input))
	s := c.Segments[0]
	for _, seg := range c.Segments {
		if x <= float64(seg.DomainMax) {
			s = seg
			break
		}
	}
	k := s.Coefficients
	var v float64
	switch s.Kind {
	case "identity":
		v = x
	case "constant":
		v = float64(k[0])
	case "linear":
		v = float64(k[0])*x + float64(k[1])
	case "power":
		v = float64(k[0]) + float64(k[1]-k[0])*math.Pow(x, float64(k[2]))
	default:
		v = float64(k[0])*x*x*x + float64(k[1])*x*x + float64(k[2])*x + float64(k[3])
	}
	if c.Saturate {
		v = math.Min(1, math.Max(0, v))
	}
	return float64(c.RangeMin) + float64(c.RangeMax-c.RangeMin)*v
}

func TestReadCurveHitIntensityAndRadius(t *testing.T) {
	g, err := decodeGeneratorConstants(hitConstants(), hitProperties())
	if err != nil {
		t.Fatal(err)
	}
	in, rad := g.HitIntensity.Curve, g.HitRadius.Curve
	if in == nil || rad == nil {
		t.Fatalf("curves not read: %+v %+v", g.HitIntensity, g.HitRadius)
	}
	if len(in.Segments) != 2 || in.Segments[0].Kind != "linear" || in.Segments[1].Kind != "cubic" || !in.Saturate {
		t.Errorf("intensity curve %+v", in)
	}
	near := func(got, want float64) bool { return math.Abs(got-want) < 0.05 }
	for _, c := range []struct{ age, intensity, radius float64 }{
		{0, 90, 0.1}, {0.10333333, 18.86, 0.0993}, {0.5, 1.42, 0.0965}, {1, 0, 0.05}, {2, 0, 0.05},
	} {
		if got := curveAt(in, c.age); !near(got, c.intensity) {
			t.Errorf("intensity at %g s: %g, want %g", c.age, got, c.intensity)
		}
		if got := curveAt(rad, c.age); math.Abs(got-c.radius) > 0.001 {
			t.Errorf("radius at %g s: %g, want %g", c.age, got, c.radius)
		}
	}
	if g.InverseHitTime != 1 {
		t.Errorf("inverse hit time %g", g.InverseHitTime)
	}
}

func TestReadCurveRefusesWhatOneCurveDoesNotCarry(t *testing.T) {
	p := hitProperties()
	if readCurve(p[:16], 0) != nil {
		t.Error("a missing record read as a curve")
	}
	excl := append([]byte(nil), p...)
	binary.LittleEndian.PutUint32(excl[2*16:], math.Float32bits(52+8))
	if readCurve(excl, 0) != nil {
		t.Error("an exclusion band read as a plain curve")
	}
	periodic := append([]byte(nil), p...)
	binary.LittleEndian.PutUint32(periodic[5*16:], math.Float32bits(3))
	if readCurve(periodic, 0) != nil {
		t.Error("a periodic segment read as a plain curve")
	}
	// A property blending two curves by a second input (y&31) is published with no curve.
	c := hitConstants()
	binary.LittleEndian.PutUint32(c[240+4:], math.Float32bits(2))
	g, err := decodeGeneratorConstants(c, p)
	if err != nil || g.HitIntensity.Curve != nil || g.HitIntensity.Input != "impactTime" {
		t.Errorf("blended property: %+v, %v", g.HitIntensity, err)
	}
}

func TestDecodeGeneratorConstants(t *testing.T) {
	g, err := decodeGeneratorConstants(hitConstants(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if g.HitColorMode != 3 || g.EdgeColorMode != 0 || g.TintInsteadOfReplace || g.UseHitBlob {
		t.Errorf("modes: %+v", g)
	}
	for name, p := range map[string]GeneratorProperty{"edge": g.EdgeGlowIntensity, "center": g.PlasmaCenterIntensity,
		"plasmaEdge": g.PlasmaEdgeIntensity, "flat": g.FlatColorIntensity, "oscillation": g.OscillationAmplitude,
		"desaturation": g.ColorOverrideDesaturation} {
		if p.Constant == nil || *p.Constant != 0 || p.Input != "" {
			t.Errorf("%s: %+v, want the constant 0", name, p)
		}
	}
	if p := g.ExtrusionDistance; p.Constant == nil || *p.Constant != 0.005 {
		t.Errorf("extrusion: %+v", p)
	}
	if p := g.HitIntensity; p.Constant != nil || p.Input != "impactTime" {
		t.Errorf("hit intensity: %+v, want a function of impactTime", p)
	}
	if p := g.HitRadius; p.Constant != nil || p.Input != "impactTime" {
		t.Errorf("hit radius: %+v", p)
	}
	if g.EdgeInnerFadeRadius != 0.75 || g.EdgeScaleOuter != 19.999996 || g.EdgeScaleInner != -1.4285715 ||
		g.PlasmaInnerFadeRadius != 0.75 || g.PlasmaEdgeScaleOuter != 19.999996 || g.PlasmaEdgeScaleInner != -1.4285715 {
		t.Errorf("radii: %+v", g)
	}
	if g.PlasmaTileScale != 2 || g.PlasmaScrollSpeed != 0.1 || g.PlasmaCenterSharpness != 1 || g.PlasmaEdgeSharpness != 0 ||
		g.Plasma0Intensity != 1 || g.Plasma1Sharpness != 1 || g.Noise2VScale != 1 || g.ExposureAmount != 1 {
		t.Errorf("plasma: %+v", g)
	}
	// A function-driven property with no property buffer is published with its input and no curve.
	raw, err := json.Marshal(g.HitIntensity)
	if err != nil || string(raw) != `{"input":"impactTime"}` {
		t.Errorf("hit intensity JSON %s, %v", raw, err)
	}
}

func TestDecodeGeneratorConstantsRefusesAnotherLayout(t *testing.T) {
	if _, err := decodeGeneratorConstants(make([]byte, 432), nil); err == nil {
		t.Error("a 432-byte buffer decoded")
	}
}

func TestIndexWithoutShieldHitIsStale(t *testing.T) {
	// A library of the previous schema predates the shield impact and is rebuilt.
	idx := NewIndex(nil, "test")
	idx.Schema = SchemaCurrent - 1
	raw, err := json.Marshal(idx)
	if err != nil {
		t.Fatal(err)
	}
	if IndexCurrent(raw) {
		t.Error("an index of the previous schema reads as current")
	}
}
