package mapmesh

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
)

// TestFrameOf: the frame follows the background's convention (origin at the top-left corner, Y
// descending with the image) and takes an arena's margin below coteCadreGrand, a large map's
// margin from it on.
func TestFrameOf(t *testing.T) {
	cases := []struct {
		name string
		cal  replay.MapBackgroundCalibration
		want [4]float64
	}{
		{"arena", replay.MapBackgroundCalibration{MetersPerPixel: 0.05, OriginX: -100, OriginY: 50, WidthPx: 1000, HeightPx: 1200},
			[4]float64{-100 - frameMargin, -10 - frameMargin, -50 + frameMargin, 50 + frameMargin}},
		{"large map", replay.MapBackgroundCalibration{MetersPerPixel: 0.1, OriginX: 0, OriginY: 0, WidthPx: 900, HeightPx: largeFrameSide * 10},
			[4]float64{-frameMarginLarge, -largeFrameSide - frameMarginLarge, 90 + frameMarginLarge, frameMarginLarge}},
	}
	for _, c := range cases {
		got := FrameOf(c.cal)
		for k := range got {
			if d := got[k] - c.want[k]; d > 1e-9 || d < -1e-9 {
				t.Errorf("%s: %v, want %v", c.name, got, c.want)
				break
			}
		}
	}
}
