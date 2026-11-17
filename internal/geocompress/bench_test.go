package geocompress

import (
	"context"
	"io"
	"os"
	"sort"
	"strings"
	"testing"
)

// TestMeasureFiles — a measurement, not a check: with IT3D_GEOCOMPRESS_GLB set to one or more
// GLB paths (separated by ';'), compresses each in memory at a few position steps and logs the
// size per kind of view, the errors and the time. Run it on built maps and variants to choose
// the defaults:
//
//	$env:IT3D_GEOCOMPRESS_GLB='C:\...\maps\sgh_streets.glb'; go test ./internal/geocompress -run TestMeasureFiles -v
func TestMeasureFiles(t *testing.T) {
	paths := os.Getenv("IT3D_GEOCOMPRESS_GLB")
	if paths == "" {
		t.Skip("IT3D_GEOCOMPRESS_GLB not set")
	}
	steps := []float64{DefaultPositionStep}
	if s := os.Getenv("IT3D_GEOCOMPRESS_STEPS"); s == "all" {
		steps = []float64{-1, 1.0 / 256, 1.0 / 1024, 1.0 / 4096}
	}
	for _, p := range strings.Split(paths, ";") {
		f, err := os.Open(p)
		if err != nil {
			t.Fatal(err)
		}
		info, _ := f.Stat()
		for _, step := range steps {
			st, err := Compress(context.Background(), f, info.Size(), io.Discard, Options{PositionStep: step})
			if err != nil {
				t.Fatal(p, err)
			}
			t.Logf("%s step=%g: %.1f MB -> %.1f MB (%.1f%%) in %s, %d views compressed, %d kept, %d triangles, max position error %.6g, attribute errors %v",
				p, step, mb(st.BytesIn), mb(st.BytesOut), 100*float64(st.BytesOut)/float64(st.BytesIn), st.Duration, st.Compressed, st.Kept, st.Triangles, st.MaxPositionError, st.MaxAttributeError)
			kinds := make([]string, 0, len(st.ByKind))
			for k := range st.ByKind {
				kinds = append(kinds, k)
			}
			sort.Strings(kinds)
			for _, k := range kinds {
				ks := st.ByKind[k]
				t.Logf("    %-16s %5d views %9.1f MB -> %9.1f MB (%.1f%%)", k, ks.Views, mb(ks.BytesIn), mb(ks.BytesOut), 100*float64(ks.BytesOut)/float64(max(1, ks.BytesIn)))
			}
		}
		_ = f.Close()
	}
}

func mb(n int64) float64 { return float64(n) / 1e6 }
