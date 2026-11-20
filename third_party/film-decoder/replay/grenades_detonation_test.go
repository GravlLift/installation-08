package replay

// grenades_detonation_test.go — LOCAL-CHANGE (infinite-theater-3d): a throw whose flight is not published
// still publishes the detonation the film writes for its projectile (Grenade.Deto).
//
// THE CASE IT REPRODUCES: match 9220185c, frame 13193, KamUz 7w7 (film index 3, slot 613) throws a plasma
// point-blank onto BC0R. Its projectile 1179/1 replicates no position (no track), so the throw had no
// `proj` and its explosion, written by the film at 13222.81 as projectile reference 155/1, was lost.

import (
	"reflect"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// The match's own numbers, on its own grid (origin 983073101 us, 33 ms frames).
const (
	stickOriginUS = 983_073_101
	stickStepUS   = 33_000
	stickThrowUS  = stickOriginUS + 13193*stickStepUS + 10_000
	stickDetoUS   = 1_419_425_927 // frame 13222.81
)

func stickThrow() grammar.GrenadeThrow {
	return grammar.GrenadeThrow{TimestampUS: stickThrowUS, FilmIndex: 3, TypeID: grammar.GrenadePlasma,
		Life: types.LifeKey{Slot: 1179, Gen: 1}, HasLife: true}
}

func stickDetonations() []types.ProjectileDetonation {
	return []types.ProjectileDetonation{
		// Another projectile's detonation at the same instant (uegjragn's plasma, 1178/1 -> 154/1).
		{TimestampUS: stickDetoUS, Genre: 5, Projectile: types.LifeKey{Slot: 154, Gen: 1}, HasProjectile: true,
			X: 5.992727, Y: 4.986382, Z: 2.2125244, HasPosition: true},
		{TimestampUS: stickDetoUS, Genre: 5, Projectile: types.LifeKey{Slot: 155, Gen: 1}, HasProjectile: true,
			X: 9.690107, Y: 5.0871167, Z: 5.0201416, HasPosition: true},
	}
}

func TestStuckThrowWithoutFlightPublishesItsDetonation(t *testing.T) {
	pos := []grammar.BipedPosition{grenPos(613, stickThrowUS, 10.14, 5.28)}
	gren, _ := buildGrenadesEtDetonations(pos, []grammar.GrenadeThrow{stickThrow()}, stickOriginUS, stickStepUS,
		occupantsPlats(map[uint32]int{613: 3}), nil, nil, stickDetonations())
	if len(gren) != 1 {
		t.Fatalf("one throw expected, got %d: %+v", len(gren), gren)
	}
	g := gren[0]
	if g.Proj != nil || g.Src != GrenadeSrcBiped {
		t.Fatalf("the throw has no flight: proj %v src %q", g.Proj, g.Src)
	}
	want := GrenadeDetonation{T: 13222, X: 9.69, Y: 5.09, Z: 5.02}
	if g.Deto == nil || *g.Deto != want {
		t.Fatalf("deto %+v, want %+v (the detonation naming 1179/1, not the other one)", g.Deto, want)
	}
}

func TestThrowDetonationNeedsItsOwnHandle(t *testing.T) {
	pos := []grammar.BipedPosition{grenPos(613, stickThrowUS, 10.14, 5.28)}
	occ := occupantsPlats(map[uint32]int{613: 3})
	early := stickDetonations()
	for i := range early {
		early[i].TimestampUS = stickThrowUS - 1
	}
	late := stickDetonations()
	for i := range late {
		late[i].TimestampUS = stickThrowUS + grenadeDetonationWindowUS + 1
	}
	for name, c := range map[string]struct {
		th    grammar.GrenadeThrow
		detos []types.ProjectileDetonation
	}{
		"other generation":            {func() grammar.GrenadeThrow { g := stickThrow(); g.Life.Gen = 2; return g }(), stickDetonations()},
		"no life read":                {func() grammar.GrenadeThrow { g := stickThrow(); g.HasLife = false; return g }(), stickDetonations()},
		"detonation before the throw": {stickThrow(), early},
		"detonation past the window":  {stickThrow(), late},
	} {
		gren, _ := buildGrenadesEtDetonations(pos, []grammar.GrenadeThrow{c.th}, stickOriginUS, stickStepUS, occ, nil, nil,
			c.detos)
		if len(gren) != 1 || gren[0].Deto != nil {
			t.Errorf("%s: %+v, want one throw without deto", name, gren)
		}
	}
}

// The throw lives cross the facts file (schema 25): what the blob reads back gets its life again, and a
// count that does not match the throws is an error, never a partial assignment.
func TestThrowLivesRoundTripThroughTheFacts(t *testing.T) {
	src := &FilmFacts{}
	src.Grenades = []grammar.GrenadeThrow{stickThrow(), {TimestampUS: 5, FilmIndex: 1, TypeID: grammar.GrenadeFragmentation}}
	var w gwriter
	encodeViesDesLancers(&w, src)
	dst := &FilmFacts{}
	dst.Grenades = []grammar.GrenadeThrow{
		{TimestampUS: stickThrowUS, FilmIndex: 3, TypeID: grammar.GrenadePlasma},
		{TimestampUS: 5, FilmIndex: 1, TypeID: grammar.GrenadeFragmentation},
	}
	r := &greader{b: w.b}
	decodeViesDesLancers(r, dst)
	if r.err != nil || !reflect.DeepEqual(dst.Grenades, src.Grenades) {
		t.Fatalf("round trip: err %v, got %+v want %+v", r.err, dst.Grenades, src.Grenades)
	}
	short := &FilmFacts{}
	short.Grenades = dst.Grenades[:1]
	r = &greader{b: w.b}
	decodeViesDesLancers(r, short)
	if r.err == nil {
		t.Fatal("2 lives for 1 throw must be refused")
	}
}

func TestThrowWithAFlightKeepsTheProjectileExplosion(t *testing.T) {
	// A throw linked to its published flight: its explosion is the projectile's, no second one.
	pos := []grammar.BipedPosition{grenPos(613, stickThrowUS, 10.14, 5.28)}
	proj := []types.ProjectileTrack{{Slot: 1179, Gen: 1, Pts: []types.ProjectileSample{
		{TimestampUS: stickThrowUS + 5_000, X: 10.2, Y: 5.3},
	}}}
	gren, _ := buildGrenadesEtDetonations(pos, []grammar.GrenadeThrow{stickThrow()}, stickOriginUS, stickStepUS,
		occupantsPlats(map[uint32]int{613: 3}), proj, map[int]int{0: 0}, stickDetonations())
	if len(gren) != 1 || gren[0].Proj == nil || gren[0].Deto != nil {
		t.Fatalf("got %+v: want proj set and no deto", gren)
	}
}
