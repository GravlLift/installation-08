package replay

// filmfacts_lancers.go — LOCAL-CHANGE (infinite-theater-3d): THE PROJECTILE LIFE OF EACH GRENADE THROW
// IN THE FACTS FILE (facts schema 25): `grammar.GrenadeThrow.Life` / `HasLife`, in the complement of
// section 1 ([encodeComplementDesEntrees]), after the attach reads, one entry per throw in the order of
// `FilmInputs.Grenades` (the blob of the inputs keeps its v29 layout for the throws themselves).
//
// SCHEMA 25 (2026-11-19): a schema-24 complement carries no throw lives. Read by this codec it would
// stop short of the verdict, so it is refused on its header instead, and redecoded.

import (
	"fmt"

	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// encodeViesDesLancers writes, for each throw, whether its life was read, then the life itself.
func encodeViesDesLancers(w *gwriter, g *FilmFacts) {
	w.u(uint64(len(g.Grenades)))
	for _, t := range g.Grenades {
		w.bool8(t.HasLife)
		if t.HasLife {
			w.u(uint64(t.Life.Slot))
			w.u(uint64(t.Life.Gen))
		}
	}
}

// decodeViesDesLancers reads back what [encodeViesDesLancers] writes onto the throws the blob already
// read. A count that does not match them is an error of the file, never a partial assignment.
func decodeViesDesLancers(r *greader, g *FilmFacts) {
	n := r.compte(1)
	if r.err == nil && n != len(g.Grenades) {
		r.err = fmt.Errorf("throw lives: %d entries for %d throws", n, len(g.Grenades))
		return
	}
	for k := 0; k < n && r.err == nil; k++ {
		if !r.bool8() {
			continue
		}
		g.Grenades[k].Life = types.LifeKey{Slot: uint32(r.u()), Gen: uint32(r.u())} //nolint:gosec // written from a uint32
		g.Grenades[k].HasLife = true
	}
}
