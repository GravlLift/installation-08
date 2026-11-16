package replay

// projectiles_attache.go — LOCAL-CHANGE (infinite-theater-3d): THE PROJECTILE THAT STICKS, published.
//
// A plasma or spike grenade that sticks to something stops replicating its position. Its last record
// names what it is stuck to instead (`grammar.ScanProjectileAttaches`): the PARENT object (same slot
// space as the biped tracks), a NODE of that parent (the render model's node index, the skin joint
// of the same rank in the viewer's Spartan GLB: 22 is `b_r_foot`, 26 `b_torso`, 61 `b_helmet`,
// 95 `b_r_grip`), and a POSE: three R(16) that place the projectile in that node's frame.
//
// THE POSE'S DEQUANTIZATION IS MEASURED, NOT READ FROM THE GAME CODE. Over the 36 stored stuck
// grenades whose parent is a drawn player (2026-11-16, web scene3d/attachCalibration.research.test.ts),
// the detonation point expressed in that node's frame of the viewer's own animated Spartan matches
// the three values as the Halo axes (x, y, z) of the node (the GLB's frame is halo(x, z, -y)), each a
// symmetric 16-bit quantum over [-2, 2] world units with the decoder's midpoint convention
// ([attachePoseRange]): median distance 0.107 u, against 0.154 u for the node's origin, 25 of 36
// cases closer. The residual is the viewer's reconstructed animation as much as the read: the range
// is the best of 1..8 u, not a constant found in the binary.
//
// What is published is the read itself plus that dequantized offset. The document does not compose
// a world position: the node's place is the viewer's animation, which the document does not carry.

import (
	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// attachePoseRange is the half-range (world units) of each pose quantum ([ProjectileAttach.Pose]).
const attachePoseRange = 2

// ProjectileAttach is where a projectile that sticks sits from FromFrame until it explodes (DetoT).
type ProjectileAttach struct {
	// FromFrame is the frame of the attach read, on the same axis as Point.T.
	FromFrame int `json:"fromFrame"`
	// ParentSlot is the slot of the object the projectile is stuck to: a player's track slot when
	// it is a biped (a slot serves one life at a time); a device, a weapon or a Forge object otherwise.
	ParentSlot uint32 `json:"parentSlot"`
	// Node is the parent's node (render model node index, the GLB skin joint of the same rank).
	Node uint32 `json:"node"`
	// Pose is the projectile's offset in that node's frame, Halo axes, world units (rounded to the mm).
	Pose [3]float32 `json:"pose"`
}

// attachePose dequantizes the three R(16) of an attach read ([attachePoseRange]).
func attachePose(q [3]uint32) [3]float32 {
	var out [3]float32
	for a := range 3 {
		out[a] = round3(float32(attachePoseRange) * (2*(float32(q[a])+0.5)/65536 - 1))
	}
	return out
}

// round3 rounds to the millimeter.
func round3(v float32) float32 {
	if v < 0 {
		return -float32(int64(-v*1000+0.5)) / 1000
	}
	return float32(int64(v*1000+0.5)) / 1000
}

// premiersAttaches keys the FIRST attach read of each projectile life (the reads come in stream order).
func premiersAttaches(reads []grammar.ProjectileAttach) map[[2]uint32]grammar.ProjectileAttach {
	if len(reads) == 0 {
		return nil
	}
	out := make(map[[2]uint32]grammar.ProjectileAttach, len(reads))
	for _, a := range reads {
		k := [2]uint32{a.Life.Slot, a.Life.Gen}
		if _, ok := out[k]; !ok {
			out[k] = a
		}
	}
	return out
}

// poserLesAttaches sets the attach of each PUBLISHED projectile (`pubByRaw`: raw track rank ->
// published rank, from [buildProjectiles]) whose life has an attach read.
func poserLesAttaches(published []Projectile, pubByRaw map[int]int, tracks []types.ProjectileTrack,
	reads []grammar.ProjectileAttach, origin, step uint64) {
	premiers := premiersAttaches(reads)
	if premiers == nil {
		return
	}
	for raw, tr := range tracks {
		i, pub := pubByRaw[raw]
		if !pub || len(tr.Pts) == 0 {
			continue
		}
		a, ok := premiers[[2]uint32{tr.Slot, tr.Gen}]
		published[i].Attach = attacheDuVol(a, ok, tr.Pts[0].TimestampUS, origin, step, published[i].DetoT)
	}
}

// attacheDuVol builds the published attach of a flight: its life's first attach read when it falls
// after the flight's first sample and no later than the explosion; nil otherwise.
func attacheDuVol(a grammar.ProjectileAttach, ok bool, t0US, origin, step uint64, detoT int) *ProjectileAttach {
	if !ok || a.TimestampUS < t0US || a.TimestampUS < origin {
		return nil
	}
	from := int((a.TimestampUS - origin) / step) //nolint:gosec // frame index of a match
	if from > detoT {
		return nil
	}
	return &ProjectileAttach{FromFrame: from, ParentSlot: a.Parent.Slot, Node: a.Node, Pose: attachePose(a.Pose)}
}
