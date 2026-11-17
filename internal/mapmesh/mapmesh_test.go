// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package mapmesh

import (
	"context"
	"fmt"
	"io"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/texcompress"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/JGtm/halo-infinite-map-images/himap"
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

// TestBuildFormatWritten — a GLB written the way the builds write it carries the current
// build format in asset.extras: the server's readiness check reads it back (header-only) and
// a GLB without the field, or with an older one, is not current. The extras here are merged
// exactly as Build and BuildVariant merge them (commonExtras).
func TestBuildFormatWritten(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "m.glb")
	m := &himap.MaillageMonde{
		Structure: himap.GroupeMaillage{
			Sommets: []float32{1, 2, 3, 4, 5, 6, 7, 8, 9, 7, 8, 9},
			Indices: map[uint32][]uint32{0xA: {0, 1, 2}, 0xB: {1, 2, 3}},
		},
		Materiaux: map[uint32]himap.Materiau{0xA: {ID: 0xA}, 0xB: {ID: 0xB, Melange: himap.MelangeAlpha}},
	}
	extras := map[string]any{"module": "m"}
	for k, v := range commonExtras() {
		extras[k] = v
	}
	if _, err := writeGLB(context.Background(), path, "m", texcompress.FormatPNG, progress{}, func(w io.Writer) error {
		return himap.EcritGLB(w, m, "test", extras)
	}); err != nil {
		t.Fatal(err)
	}
	got, err := texcompress.AssetExtras(path)
	if err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(got[BuildFormatKey]) != fmt.Sprint(BuildFormat) {
		t.Errorf("written buildFormat = %v, want %d", got[BuildFormatKey], BuildFormat)
	}
	if got[axesGLBKey] != axesGLB {
		t.Errorf("written axes = %v, want %q", got[axesGLBKey], axesGLB)
	}
}
