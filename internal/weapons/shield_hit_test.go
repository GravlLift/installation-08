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

func TestDecodeGeneratorConstants(t *testing.T) {
	g, err := decodeGeneratorConstants(hitConstants())
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
	// A function-driven property is published with its input and no value.
	raw, err := json.Marshal(g.HitIntensity)
	if err != nil || string(raw) != `{"input":"impactTime"}` {
		t.Errorf("hit intensity JSON %s, %v", raw, err)
	}
}

func TestDecodeGeneratorConstantsRefusesAnotherLayout(t *testing.T) {
	if _, err := decodeGeneratorConstants(make([]byte, 432)); err == nil {
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
		t.Error("a schema-6 index reads as current")
	}
}
