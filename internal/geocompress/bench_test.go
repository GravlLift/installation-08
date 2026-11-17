package geocompress

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// TestMeasureFiles — a measurement, not a check: with IT3D_GEOCOMPRESS_GLB set to one or more
// GLB paths (separated by ';'), compresses each in memory and logs the size per kind of view,
// the errors and the time. With IT3D_GEOCOMPRESS_OUT set to a folder, also writes each
// compressed GLB there (stamped build format 3) to load it in the viewer:
//
//	$env:IT3D_GEOCOMPRESS_GLB='C:\...\maps\sgh_streets.glb'; go test ./internal/geocompress -run TestMeasureFiles -v
func TestMeasureFiles(t *testing.T) {
	paths := os.Getenv("IT3D_GEOCOMPRESS_GLB")
	if paths == "" {
		t.Skip("IT3D_GEOCOMPRESS_GLB not set")
	}
	outDir := os.Getenv("IT3D_GEOCOMPRESS_OUT")
	for _, p := range strings.Split(paths, ";") {
		f, err := os.Open(p)
		if err != nil {
			t.Fatal(err)
		}
		info, _ := f.Stat()
		var w io.Writer = io.Discard
		var o Options
		var out *os.File
		if outDir != "" {
			if out, err = os.Create(filepath.Join(outDir, filepath.Base(p))); err != nil {
				t.Fatal(err)
			}
			w = out
			o.Extras = map[string]any{"buildFormat": 3}
		}
		st, err := Compress(context.Background(), f, info.Size(), w, o)
		if out != nil {
			_ = out.Close()
		}
		_ = f.Close()
		if err != nil {
			t.Fatal(p, err)
		}
		t.Logf("%s: %.1f MB -> %.1f MB (%.1f%%) in %s, %d views compressed, %d kept, %d triangles, attribute errors %v, rejected %v",
			p, mb(st.BytesIn), mb(st.BytesOut), 100*float64(st.BytesOut)/float64(st.BytesIn), st.Duration, st.Compressed, st.Kept, st.Triangles, st.MaxAttributeError, st.Rejected)
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
}

func mb(n int64) float64 { return float64(n) / 1e6 }
