// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
package build

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

func TestScoreFilmProbe(t *testing.T) {
	dir := os.Getenv("SCORE_FILM_DIR")
	if dir == "" {
		t.Skip("SCORE_FILM_DIR not set")
	}
	film, manifest := loadFilm(context.Background(), Input{ChunkDir: filepath.Join(dir, "chunks"), ManifestPath: filepath.Join(dir, "manifest.json")}, "0ace97d0")
	if film == nil || !manifest {
		t.Fatal("film or manifest missing")
	}
	recs, _, _ := statborg(context.Background(), "0ace97d0", film)
	counts := map[string]int{}
	samples := map[string]string{}
	for _, r := range recs {
		for c, v := range r.Comps {
			key := fmt.Sprintf("slot=%d comp=%d", r.Slot, c)
			counts[key]++
			if c <= 2 {
				samples[key] = fmt.Sprintf("t=%d round=%d A=%d B=%d", r.TimeMS, r.Round, v.A, v.B)
			}
		}
	}
	keys := make([]string, 0, len(counts))
	for k := range counts {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	t.Logf("records=%d chunks=%d", len(recs), len(film.Meta()))
	for _, k := range keys {
		t.Logf("%s count=%d last=%s", k, counts[k], samples[k])
	}
	if len(recs) != 3 || len(counts) != 3 || counts["slot=6 comp=10"] != 1 || counts["slot=8 comp=10"] != 1 || counts["slot=8 comp=57"] != 1 {
		t.Fatal("film score deltas differ from the measured match")
	}
}
