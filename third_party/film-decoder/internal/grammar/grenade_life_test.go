package grammar

// grenade_life_test.go — LOCAL-CHANGE (infinite-theater-3d): a throw carries the handle of the projectile
// it creates (GrenadeThrow.Life), read from the header of its NEW record.

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/profile"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// buildGrenadeNewRecord writes a whole NEW record header (not a delta, recNew, the handle) before the
// throw's type index and primer, as the film writes a projectile's creation.
func buildGrenadeNewRecord(slot, gen uint32, id, index uint32) []byte {
	a := profile.AmorceGrenadeDeReference()
	w := &bitw{}
	w.put(0, 1) // not a delta
	w.put(1, 2) // recNew
	w.put(uint64(slot), handleSlotBits)
	w.put(uint64(gen), handleGenBits)
	w.put(uint64(ProjectileTypeIndex)>>profile.AmorceGrenadeTypeIndexBits&1, 1)
	w.put(a.MarqueurDe(ProjectileTypeIndex), a.Bits)
	w.put(uint64(id), 32)
	w.pad(a.IndexAuteurBit - a.Bits - 32)
	w.put(uint64(index), profile.AmorceGrenadeIndexBits)
	w.pad(32)
	return w.buf
}

func TestGrenadeThrowCarriesItsProjectileLife(t *testing.T) {
	got := scanGrenadesDeReference(buildGrenadeNewRecord(1179, 1, GrenadePlasma, 3))
	if len(got) != 1 {
		t.Fatalf("%d throw(s), want 1", len(got))
	}
	if !got[0].HasLife || got[0].Life != (types.LifeKey{Slot: 1179, Gen: 1}) {
		t.Errorf("life %+v (read %v), want 1179/1", got[0].Life, got[0].HasLife)
	}
	if got[0].FilmIndex != 3 {
		t.Errorf("author %d, want 3", got[0].FilmIndex)
	}
}

// A primer too close to the start of the payload for a header to precede it: no life is invented.
func TestGrenadeThrowWithoutHeaderHasNoLife(t *testing.T) {
	got := scanGrenadesDeReference(buildGrenadeRecord(5, GrenadePlasma, 3))
	if len(got) != 1 || got[0].HasLife {
		t.Fatalf("throws %+v: want one without a life (its header would start before the payload)", got)
	}
}
