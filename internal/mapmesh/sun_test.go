// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package mapmesh

import (
	"math"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// wetlandSun is fo08_wetland's stored dynamic sun (TestSoleilCartes, gamefiles): hour angle 0,
// latitude 71.6, azimuth 231.8, season 0, intensity 2, every flag set.
var wetlandSun = himap.ParametresSoleil{
	Drapeaux:  0x3ff,
	Couleur:   [3]float64{1, 1, 1},
	Intensite: 2,
	Latitude:  71.6,
	Azimut:    231.8,
}

func nearSun(a, b [3]float64) bool {
	for i := range a {
		if math.Abs(a[i]-b[i]) > 0.002 {
			return false
		}
	}
	return true
}

// TestTargetSun: without the target's own settings the sun is the scenario's; Origin's Sun
// Direction (yaw 0, pitch 330) moves it with the canvas's hour angle and season; its intensity
// and color still override.
func TestTargetSun(t *testing.T) {
	s, ok := targetSun(wetlandSun, Target{})
	if !ok || !nearSun(s.Direction, [3]float64{-0.586, 0.461, 0.667}) || s.Intensite != 2 {
		t.Fatalf("canvas sun: %+v %v", s, ok)
	}
	az, lat, i := 0.0, 330.0, 2.0
	color := [3]float64{1, 0.712, 0.410}
	s, ok = targetSun(wetlandSun, Target{SunAzimuth: &az, SunLatitude: &lat, SunIntensity: &i, SunColor: &color})
	if !ok || !nearSun(s.Direction, [3]float64{0, 0.803, 0.596}) || s.Intensite != 2 || s.Couleur != color {
		t.Fatalf("Origin's sun: %+v %v", s, ok)
	}
	below := 180.0
	if _, ok := targetSun(wetlandSun, Target{SunLatitude: &below}); ok {
		t.Fatal("a sun below the horizon was kept")
	}
}
