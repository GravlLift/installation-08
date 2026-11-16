package replay

// filmfacts_attaches.go — LOCAL-CHANGE (infinite-theater-3d): THE ATTACH READS OF THE PROJECTILES
// THAT STICK IN THE FACTS FILE (facts schema 24): `FilmInputs.ProjectileAttaches`
// (`grammar.ProjectileAttach`, raw, in stream order), in the complement of section 1
// ([encodeComplementDesEntrees]), after the control buttons.
//
// SCHEMA 24 (2026-11-16): a schema-23 complement carries no attach reads. Read by this codec it would
// stop short of the verdict, so it is refused on its header instead, and redecoded.

import (
	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// encodeAttachesDeProjectile writes the reads (sorted by instant, hence the delta), every field raw.
func encodeAttachesDeProjectile(w *gwriter, reads []grammar.ProjectileAttach) {
	w.u(uint64(len(reads)))
	var last uint64
	for _, a := range reads {
		w.u(a.TimestampUS - last)
		last = a.TimestampUS
		for _, v := range [...]uint32{a.Life.Slot, a.Life.Gen, a.Parent.Slot, a.Parent.Gen, a.Node,
			a.Pose[0], a.Pose[1], a.Pose[2], a.Orient, a.Byte8} {
			w.u(uint64(v))
		}
		w.bool8(a.HasOrient)
	}
}

// decodeAttachesDeProjectile reads back what [encodeAttachesDeProjectile] writes; an empty list
// reads back nil.
func decodeAttachesDeProjectile(r *greader) []grammar.ProjectileAttach {
	n := r.compte(12)
	out := make([]grammar.ProjectileAttach, 0, n)
	var last uint64
	for k := 0; k < n && r.err == nil; k++ {
		last += r.u()
		var v [10]uint32
		for i := range v {
			v[i] = uint32(r.u()) //nolint:gosec // written from a uint32
		}
		out = append(out, grammar.ProjectileAttach{TimestampUS: last,
			Life: types.LifeKey{Slot: v[0], Gen: v[1]}, Parent: types.LifeKey{Slot: v[2], Gen: v[3]},
			Node: v[4], Pose: [3]uint32{v[5], v[6], v[7]}, Orient: v[8], Byte8: v[9], HasOrient: r.bool8()})
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
