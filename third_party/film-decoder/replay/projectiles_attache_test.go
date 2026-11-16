package replay

// projectiles_attache_test.go — LOCAL-CHANGE (infinite-theater-3d): the attach a stuck projectile
// publishes (projectiles_attache.go).

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// lectureDuProj107 is the attach read of projectile 107 of d01ba030 (the plasma grenade stuck to
// DesTroy's foot at 4:31): the raw values `grammar.TestProjectileAttachedI10OnCapturedRecord` reads
// from the captured record (slot 1133, parent 561 gen 1, node 22, pose {32214, 33936, 33041}).
func lectureDuProj107(ts uint64) grammar.ProjectileAttach {
	return grammar.ProjectileAttach{TimestampUS: ts, Life: types.LifeKey{Slot: 1133, Gen: 1},
		Parent: types.LifeKey{Slot: 561, Gen: 1}, Node: 22, Pose: [3]uint32{32214, 33936, 33041},
		HasOrient: true, Orient: 0x79101, Byte8: 0x3c}
}

// volColle is a short flight of life (slot, gen) from `t0` (us), one sample per 20 ms, `n` samples.
func volColle(slot, gen uint32, t0 uint64, n int) types.ProjectileTrack {
	tr := types.ProjectileTrack{Slot: slot, Gen: gen}
	for i := range n {
		tr.Pts = append(tr.Pts, types.ProjectileSample{TimestampUS: t0 + uint64(i)*20_000, X: 16 + float32(i)*0.1, Y: -15, Z: 4.8})
	}
	return tr
}

func TestProjectileQuiColleSurDesTroyPublieSonAttache(t *testing.T) {
	const origin, step = 1_000_000, 100_000
	tracks := []types.ProjectileTrack{
		volColle(1133, 1, 2_000_000, 10), // proj 107: thrown at 2.0 s, sticks at 2.2 s
		volColle(1140, 1, 2_050_000, 10), // another grenade, not stuck
	}
	detos := []types.ProjectileDetonation{
		{TimestampUS: 3_200_000, HasPosition: true, X: 16.9, Y: -15, Z: 4.8},
		{TimestampUS: 3_300_000, HasPosition: true, X: 50, Y: 50, Z: 1},
	}
	out, pubByRaw, _ := buildProjectiles(tracks, origin, step, detos, nil)
	poserLesAttaches(out, pubByRaw, tracks, []grammar.ProjectileAttach{lectureDuProj107(2_230_000)}, origin, step)

	p := out[pubByRaw[0]]
	if p.Attach == nil {
		t.Fatalf("proj 107 ne publie pas son attache : %+v", p)
	}
	want := ProjectileAttach{FromFrame: 12, ParentSlot: 561, Node: 22, Pose: [3]float32{-0.034, 0.071, 0.017}}
	if *p.Attach != want {
		t.Errorf("attache publiee %+v, attendu %+v", *p.Attach, want)
	}
	if p.Attach.FromFrame > p.DetoT {
		t.Errorf("l attache (%d) suit l explosion (%d)", p.Attach.FromFrame, p.DetoT)
	}
	if other := out[pubByRaw[1]]; other.Attach != nil {
		t.Errorf("une grenade qui ne colle pas publie une attache : %+v", *other.Attach)
	}
}

func TestAttacheIgnoreUneLectureHorsDuVol(t *testing.T) {
	const origin, step = 1_000_000, 100_000
	tracks := []types.ProjectileTrack{volColle(1133, 1, 2_000_000, 10)}
	cas := map[string]grammar.ProjectileAttach{
		"avant le vol":      lectureDuProj107(1_900_000),
		"apres l explosion": lectureDuProj107(9_000_000),
		"une autre vie":     func() grammar.ProjectileAttach { a := lectureDuProj107(2_230_000); a.Life.Gen = 2; return a }(),
	}
	for nom, a := range cas {
		out, pubByRaw, _ := buildProjectiles(tracks, origin, step, nil, nil)
		poserLesAttaches(out, pubByRaw, tracks, []grammar.ProjectileAttach{a}, origin, step)
		if got := out[pubByRaw[0]].Attach; got != nil {
			t.Errorf("%s : attache publiee %+v", nom, *got)
		}
	}
}

func TestAttacheGardeLaPremiereLecture(t *testing.T) {
	const origin, step = 1_000_000, 100_000
	tracks := []types.ProjectileTrack{volColle(1133, 1, 2_000_000, 10)}
	second := lectureDuProj107(2_330_000)
	second.Node = 26
	detos := []types.ProjectileDetonation{{TimestampUS: 3_200_000, HasPosition: true, X: 16.9, Y: -15, Z: 4.8}}
	out, pubByRaw, _ := buildProjectiles(tracks, origin, step, detos, nil)
	poserLesAttaches(out, pubByRaw, tracks, []grammar.ProjectileAttach{lectureDuProj107(2_230_000), second}, origin, step)
	if got := out[pubByRaw[0]].Attach; got == nil || got.Node != 22 || got.FromFrame != 12 {
		t.Errorf("attache %+v, attendu la premiere lecture (noeud 22, image 12)", got)
	}
}
