package replay

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/facts/fallback"
	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
)

// viseesAbsoluesDe reconstruit les colonnes de visee d une piste en absolu.
func viseesAbsoluesDe(f *FullRateTrack) []viseeAbsolue {
	var out []viseeAbsolue
	var v viseeAbsolue
	for i := range f.AimT {
		v = viseeAbsolue{t: v.t + f.AimT[i], h: v.h + f.H[i], p: v.p + f.P[i]}
		out = append(out, v)
	}
	return out
}

// TestLesViseesSansPositionEntrentDansLeurVie : deux vies du slot 100 ; des visees sans position dans la
// premiere (pendant la lacune de 6 s ou le slot ne replique aucune position), dans la seconde, entre les
// deux vies, et sur un slot sans position. Chaque vie recoit les siennes, fusionnees dans l ordre du
// temps, et le reste se compte.
func TestLesViseesSansPositionEntrentDansLeurVie(t *testing.T) {
	pos := positionsA60Hz()
	visee := func(slot uint32, ts uint64, h uint32) grammar.BipedAim {
		return grammar.BipedAim{Slot: slot, TimestampUS: ts, YawRaw: h, PitchRaw: 1024}
	}
	seules := []grammar.BipedAim{
		visee(100, 9_500_000, 7), // seconde vie, entre deux positions
		visee(100, 4_000_000, 5), // premiere vie, pendant la lacune
		visee(100, 1_016_900, 3), // premiere vie, a la milliseconde de sa premiere visee de position
		visee(100, 5_000_500, 9), // entre les deux vies : aucune
		visee(300, 2_000_000, 1), // slot sans position : aucune
	}
	tracks, cov := decimateTracks(pos, decoupeDesTraces{
		origin: 1_000_000, step: 100_000, minPoints: 1,
		vies: []lifeSpan{{slot: 100, from: 1_000_000, to: 5_000_000, xuid: 111},
			{slot: 100, from: 5_001_000, to: 10_000_000, xuid: 222}},
		fb: fallback.NouveauCompteur(), visees: seules,
	})
	if len(tracks) != 2 {
		t.Fatalf("%d pistes, attendu 2", len(tracks))
	}
	if cov.FullRateAimOnlySamples != 3 || cov.AimOnlyNoLife != 2 {
		t.Fatalf("couverture : %d au plein debit, %d sans vie ; attendu 3 et 2", cov.FullRateAimOnlySamples, cov.AimOnlyNoLife)
	}
	total := 0
	for i, tr := range tracks {
		vs := viseesAbsoluesDe(tr.FullRate)
		total += len(vs)
		for j := 1; j < len(vs); j++ {
			if vs[j].t < vs[j-1].t {
				t.Fatalf("piste %d : visee %d a t=%d avant la precedente (%d) — la fusion n est pas triee", i, j, vs[j].t, vs[j-1].t)
			}
		}
	}
	if total != cov.FullRateAimSamples {
		t.Errorf("colonnes %d, couverture %d", total, cov.FullRateAimSamples)
	}
	premiere := viseesAbsoluesDe(tracks[0].FullRate)
	if premiere[0].t != 16 || premiere[0].h != 4091 || premiere[1].t != 16 || premiere[1].h != 3 {
		t.Errorf("premieres visees %+v %+v : a instant egal, la visee du record de position passe la premiere",
			premiere[0], premiere[1])
	}
	if !contientLaVisee(premiere, 3_000, 5) || !contientLaVisee(viseesAbsoluesDe(tracks[1].FullRate), 8_500, 7) {
		t.Error("une visee sans position manque a sa vie, ou n est pas a son instant")
	}
}

func contientLaVisee(vs []viseeAbsolue, t int64, h int32) bool {
	for _, v := range vs {
		if v.t == t && v.h == h {
			return true
		}
	}
	return false
}
