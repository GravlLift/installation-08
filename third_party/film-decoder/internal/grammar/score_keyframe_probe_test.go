// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
// LOCAL-CHANGE (infinite-theater-3d): inspect score components in a locally supplied film.
package grammar

import (
	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar/lecture"
	"github.com/JGtm/halo-infinite-film-decoder/internal/source"
	"os"
	"path/filepath"
	"testing"
)

func TestScoreKeyframeProbe(t *testing.T) {
	dir := os.Getenv("SCORE_FILM_DIR")
	if dir == "" {
		t.Skip("missing film")
	}
	film, err := source.LoadDir(filepath.Join(dir, "chunks"), nil)
	if err != nil {
		t.Fatal(err)
	}
	fc := NewFilmContext(film)
	frames, records, closed, values, nonzero := 0, 0, 0, 0, 0
	chunks := map[int]int{}
	for p, err := range fc.ImagesCles() {
		if err != nil {
			t.Fatal(err)
		}
		frames++
		for _, r := range p.Records {
			if r.TI != 6 {
				continue
			}
			records++
			chunks[p.Chunk]++
			if r.Preuve == lecture.PreuveFerme {
				closed++
			}
			for _, c := range p.Comps[r.Comps[0]:r.Comps[1]] {
				if c.Index > 1 || c.Bits == 0 {
					continue
				}
				b := LecteurSur(p.Payload)
				b.SetBitPos(int(c.Debut))
				b.ReadBits(5)
				b.ReadBits(5)
				a, z := b.ReadSignedVarWidth(), b.ReadSignedVarWidth()
				values++
				if a != 0 || z != 0 {
					nonzero++
					t.Logf("nonzero chunk=%d slot=%d component=%d bit=%d A=%d B=%d", p.Chunk, r.Vie.Slot, c.Index, c.Debut, a, z)
				}
			}
		}
	}
	t.Logf("keyframes=%d ti6=%d closed=%d score_components=%d nonzero=%d counts_per_chunk=%v", frames, records, closed, values, nonzero, chunks)
	if frames != 18 || records != 864 || closed != 864 || values != 1728 || nonzero != 0 {
		t.Fatal("film score snapshots differ from the measured match")
	}
}
