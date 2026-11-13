package replay

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/types"
)

func TestAmmoReadsOrdreAbsencesDoublonsEtRefus(t *testing.T) {
	mag, autre, reserve, fraction := uint32(10), uint32(9), uint32(30), uint32(4095)
	kf := []types.KeyframeInventory{{TimestampUS: 2000, Slot: 1, AmmoRead: true}}
	kf[0].Ammo[0].Mag = &mag
	deltas := []types.InventoryDelta{
		{TimestampUS: 3000, Slot: 1, Ammo: []types.InventoryDeltaAmmo{{WeaponSlot: 0, Mag: &autre}}},
		{TimestampUS: 2000, Slot: 1, Ammo: []types.InventoryDeltaAmmo{{WeaponSlot: 0, Mag: &autre}}},
		{TimestampUS: 4000, Slot: 1, Ammo: []types.InventoryDeltaAmmo{{WeaponSlot: 0, Res: &reserve, FracQ: &fraction}}},
	}
	got := buildAmmoReads(kf, deltas, 1000, 1000, false)
	if len(got) != 3 || got[0].Src != GrenadeSrcKeyframe || got[1].Src != GrenadeSrcDelta || got[1].Ms != 1 || got[2].Mag != nil || got[2].Gauge == nil || *got[2].Gauge != 1 {
		t.Fatalf("lectures : %+v", got)
	}
	b, err := json.Marshal(got[2])
	if err != nil || strings.Contains(string(b), `"mag"`) {
		t.Fatalf("champ absent : %s, %v", b, err)
	}
	refuse := buildAmmoReads(kf, deltas, 1000, 1000, true)
	if len(refuse) != 1 || refuse[0].Src != GrenadeSrcKeyframe {
		t.Fatalf("refus : %+v", refuse)
	}
}

func TestCodecMunitionsDelta(t *testing.T) {
	zero, mag, fraction := uint32(0), uint32(27), uint32(2048)
	entre := []types.InventoryDelta{{TimestampUS: 1000, Slot: 7, Ammo: []types.InventoryDeltaAmmo{{WeaponSlot: 0, Mag: &zero, FracQ: &fraction}, {WeaponSlot: 1, Mag: &mag, Res: &zero}}}, {TimestampUS: 2000, Slot: 8}}
	g := &FilmFacts{}
	g.InventoryDeltas = entre
	w := &gwriter{}
	encodeInventaire(w, g)
	r := &greader{b: w.b}
	var lu FilmFacts
	decodeInventaire(r, &lu)
	if r.err != nil || !reflect.DeepEqual(entre, lu.InventoryDeltas) {
		t.Fatalf("aller-retour : %+v, erreur %v", lu.InventoryDeltas, r.err)
	}
}
