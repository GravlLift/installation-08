package replay

// grenades_detonation.go — LOCAL-CHANGE (infinite-theater-3d): THE DETONATION OF A GRENADE WHOSE FLIGHT
// IS NOT PUBLISHED.
//
// A grenade's explosion is published on its projectile (`Projectile.detoT/X/Y`), and the throw reaches
// it through `Grenade.Proj`. A projectile that sticks POINT-BLANK replicates fewer than three positions
// before it rides its parent, so no flight is published, the throw has no `Proj`, and its explosion was
// lost although the film writes it (`projectile_detonate`, view A). Measured on match 9220185c, the
// game-winning stick (KamUz 7w7's plasma on BC0R, frame 13193, killed at 13222.9): no position track for
// projectile 1179/1, its detonation at frame 13222.81 at (9.69, 5.09, 5.02), on BC0R's body.
//
// THE LINK IS THE PROJECTILE'S HANDLE, not a proximity: the throw is the NEW record of its projectile and
// carries its handle (`grammar.GrenadeThrow.Life`), and the detonation names the same life without the
// 0x400 base of the projectile band ([detonationHandleBase]). Measured on 20 stored matches (3,885 throws):
// the throw's handle names the track `Grenade.Proj` links in 3,791 of 3,793 linked throws; on 9220185c every
// one of the 153 published flights names, through its detonation, its own track's life. Of the 92 throws
// without a link, 8 have no track but a detonation of their life (6 plasma ~1 s after the throw: sticks at
// arm's length), and 21 have neither (nothing is published for them).

import (
	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// GrenadeDetonation is the explosion of a grenade whose flight is not published: the film's detonation
// message for the projectile the throw created. T is the frame index on the axis of Point.T (absolute,
// like Projectile.DetoT); X/Y/Z the position, axes of the tracks, Z the height.
type GrenadeDetonation struct {
	T int     `json:"t"`
	X float32 `json:"x"`
	Y float32 `json:"y"`
	Z float32 `json:"z"`
}

// detonationHandleBase is what a detonation's projectile reference omits from the projectile's slot:
// the base of the band (domain 5 of varwidth.go). Measured: 153 of 153 published flights of 9220185c
// (reference + 0x400 = track slot, same generation), and d01ba030 (1133 <-> 109, 1206 <-> 182).
const detonationHandleBase = 0x400

// grenadeDetonationWindowUS bounds the search after the throw: the longest fuse (Dynamo, ~3 s) with a
// margin, far below the time the projectile pool takes to hand the same handle out again.
const grenadeDetonationWindowUS uint64 = 6_000_000

// detonationOfThrow returns the first detonation, with a position, that names the projectile throw `th`
// created, within [grenadeDetonationWindowUS] after the throw.
func detonationOfThrow(th grammar.GrenadeThrow, detos []types.ProjectileDetonation) (types.ProjectileDetonation, bool) {
	var best types.ProjectileDetonation
	found := false
	if !th.HasLife {
		return best, false
	}
	for _, d := range detos {
		if !d.HasProjectile || !d.HasPosition || d.Projectile.Gen != th.Life.Gen ||
			d.Projectile.Slot+detonationHandleBase != th.Life.Slot {
			continue
		}
		if d.TimestampUS < th.TimestampUS || d.TimestampUS > th.TimestampUS+grenadeDetonationWindowUS {
			continue
		}
		if !found || d.TimestampUS < best.TimestampUS {
			best, found = d, true
		}
	}
	return best, found
}

// grenadeDetonation is the published form of [detonationOfThrow] on the document's grid, nil when the
// film writes none for this throw's projectile.
func grenadeDetonation(th grammar.GrenadeThrow, detos []types.ProjectileDetonation, origin, step uint64) *GrenadeDetonation {
	d, ok := detonationOfThrow(th, detos)
	if !ok || d.TimestampUS < origin {
		return nil
	}
	return &GrenadeDetonation{
		T: int((d.TimestampUS - origin) / step), //nolint:gosec // frame index of a match
		X: round2(d.X), Y: round2(d.Y), Z: round2(d.Z),
	}
}
