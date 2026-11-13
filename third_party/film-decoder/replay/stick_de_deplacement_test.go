package replay

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// TestLeStickSePoseSurLaVieDuJoueurDeLaPlace : le joueur 3 (slot 10) tient la place 4 ; sa vie publiee
// commence a 500 ms. Le stick tenu depuis 200 ms ouvre la vie a son premier instant, un changement des
// seuls boutons n est pas un echantillon, un silence rend -1, et le changement d une place sans joueur
// comme celui d avant la vie se comptent sans se poser.
func TestLeStickSePoseSurLaVieDuJoueurDeLaPlace(t *testing.T) {
	horloge := replayClock{origin: 0, step: 100_000, frames: 1000}
	occ := occupantsPlats(map[uint32]int{10: 3})
	places := lirePlacesDeControle([]grammar.FireEvent{tirDePlace(4, 10, 100), tirDePlace(4, 10, 300)}, occ,
		horloge, map[int][2]int{3: {0, 999}}, true)
	tracks := []Track{{Slot: 10, StartFrame: 5, EndFrame: 999, FullRate: &FullRateTrack{T: []int64{500}}}}
	cov := &ControlStanceCoverage{}
	p := &posturesDeControle{places: places, occ: occ, horloge: horloge, tracks: tracks,
		viesParSlot: map[uint32][]int{10: {0}}, cov: cov}
	changement := func(place int, ts uint64, x, y int8, boutons uint8) types.ControlInputChange {
		return types.ControlInputChange{Index: place, TimestampUS: ts, Stick: [2]int8{x, y}, Buttons: boutons}
	}
	p.poserLeStick([]types.ControlInputChange{
		changement(4, 200_000, 62, 31, 0),
		changement(9, 300_000, 0, 0, 0),
		changement(4, 1_000_000, 31, 0, 0),
		changement(4, 1_050_000, 31, 0, types.ControlButtonCrouch),
		{Index: 4, TimestampUS: 2_000_000, Unknown: true, Stick: [2]int8{types.ControlStickAbsent, types.ControlStickAbsent}},
	})
	got := sticksAbsolusDe(tracks[0].FullRate)
	want := []etatDuStick{{ts: 500, x: 62, y: 31}, {ts: 1000, x: 31, y: 0}, {ts: 2000, x: -1, y: -1}}
	if len(got) != len(want) {
		t.Fatalf("stick %+v, attendu %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("echantillon %d : %+v, attendu %+v", i, got[i], want[i])
		}
	}
	if cov.StickSamples != 3 || cov.StickNoLife != 2 {
		t.Errorf("couverture : %d echantillons, %d sans vie ; attendu 3 et 2", cov.StickSamples, cov.StickNoLife)
	}
}

// sticksAbsolusDe relit les colonnes du stick en absolu (ms, valeurs brutes).
func sticksAbsolusDe(fr *FullRateTrack) []etatDuStick {
	out := make([]etatDuStick, 0, len(fr.StickT))
	var t int64
	var x, y int32
	for i := range fr.StickT {
		t, x, y = t+fr.StickT[i], x+fr.SX[i], y+fr.SY[i]
		out = append(out, etatDuStick{ts: uint64(t), x: x, y: y}) //nolint:gosec // ms >= 0
	}
	return out
}
