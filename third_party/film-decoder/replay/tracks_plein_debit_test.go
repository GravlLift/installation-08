package replay

import (
	"math"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/facts/fallback"
	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
)

// tickUS : un tick serveur a 60 Hz, tel que le film l horodate (gigue comprise, cf. `gigue`).
const tickUS = 16_667

// positionsA60Hz : une vie qui court en X a 60 Hz pendant 2 s, se tait 6 s (lacune), puis repart
// 1 s. Un record sur trois ne porte pas de visee, comme dans le film (la visee n est repliquee
// que quand elle change). La gigue de +/- 40 us imite l horloge murale du paquet.
func positionsA60Hz() []grammar.BipedPosition {
	var out []grammar.BipedPosition
	poser := func(t uint64, i int) {
		p := grammar.BipedPosition{Slot: 100, TimestampUS: t, X: float32(i) * 0.037, Y: 1.5, Z: -0.25,
			HasWorld: true}
		if i%3 != 0 {
			p.HasYaw, p.YawRaw, p.PitchRaw = true, uint32(4090+i)%4096, uint32(1000+i%7)
		}
		out = append(out, p)
	}
	t, i := uint64(1_000_000), 0
	for ; t < 3_000_000; t += tickUS {
		poser(t+gigue(i), i)
		i++
	}
	for t = 9_000_000; t < 10_000_000; t += tickUS {
		poser(t+gigue(i), i)
		i++
	}
	return out
}

func gigue(i int) uint64 { return uint64((i * 37) % 80) }

// TestLePleinDebitPublieChaqueRecordASonInstant : la piste `FullRate` porte TOUS les records
// retenus, a leur milliseconde, quand `Points` n en garde qu un par frame. C est le test qui rougit
// si la publication retombe sur la decimation par frame : le compte d echantillons serait alors
// celui des points, six fois moindre a 60 Hz.
func TestLePleinDebitPublieChaqueRecordASonInstant(t *testing.T) {
	pos := positionsA60Hz()
	const origin, step = 1_000_000, 100_000
	tracks, cov := decimateTracks(pos, decoupeDesTraces{
		origin: origin, step: step, minPoints: 1,
		vies: []lifeSpan{{slot: 100, from: 1_000_000, to: 10_000_000, xuid: 111}},
		fb:   fallback.NouveauCompteur(),
	})
	if len(tracks) != 1 || tracks[0].FullRate == nil {
		t.Fatalf("%d piste(s), plein debit present=%v ; attendu 1 piste qui le porte", len(tracks),
			len(tracks) == 1 && tracks[0].FullRate != nil)
	}
	f := tracks[0].FullRate
	if len(f.T) != len(pos) || cov.FullRateSamples != len(pos) {
		t.Fatalf("plein debit : %d echantillons (couverture %d), attendu %d — la publication est retombee "+
			"sur la decimation (%d points)", len(f.T), cov.FullRateSamples, len(pos), len(tracks[0].Points))
	}
	if cov.FullRateSamples < 5*cov.PublishedPoints {
		t.Errorf("%d echantillons pour %d points : a 60 Hz sur une grille de 100 ms, attendu environ six fois plus",
			cov.FullRateSamples, cov.PublishedPoints)
	}
	verifierColonnesDePosition(t, f, pos, origin, step)
	verifierColonnesDeVisee(t, f, pos, origin)
	if len(f.Gaps) != 1 || f.Gaps[0] != 120 {
		t.Errorf("lacunes %v, attendu [120] : l indice du record qui ROUVRE la vie apres 6 s de silence", f.Gaps)
	}
}

// verifierColonnesDePosition reconstruit t, x, y, z par somme cumulee et les confronte aux records,
// et verifie que la partie entiere de l image fractionnaire est l index de frame de la decimation.
func verifierColonnesDePosition(t *testing.T, f *FullRateTrack, pos []grammar.BipedPosition, origin, step uint64) {
	t.Helper()
	var ms, x, y, z int64
	for i, p := range pos {
		ms, x, y, z = ms+f.T[i], x+int64(f.X[i]), y+int64(f.Y[i]), z+int64(f.Z[i])
		if want := int64((p.TimestampUS - origin) / 1000); ms != want {
			t.Fatalf("echantillon %d : t=%d ms, attendu %d", i, ms, want)
		}
		if frame, want := ms*1000/int64(step), int64((p.TimestampUS-origin)/step); frame != want {
			t.Fatalf("echantillon %d : frame %d, la decimation dit %d", i, frame, want)
		}
		if float32(x)/100 != round2(p.X) || float32(y)/100 != round2(p.Y) || float32(z)/100 != round2(p.Z) {
			t.Fatalf("echantillon %d : (%d, %d, %d) centiemes, attendu (%v, %v, %v)", i, x, y, z,
				round2(p.X), round2(p.Y), round2(p.Z))
		}
	}
}

// verifierColonnesDeVisee : une visee par record qui la porte, a son instant, quantum exact, et la
// conversion publiee rend le cap et l elevation de l accesseur du film.
func verifierColonnesDeVisee(t *testing.T, f *FullRateTrack, pos []grammar.BipedPosition, origin uint64) {
	t.Helper()
	var ms, h, pi int64
	j := 0
	for _, p := range pos {
		if !p.HasYaw {
			continue
		}
		if j >= len(f.AimT) {
			t.Fatalf("%d visees publiees, le film en porte davantage", len(f.AimT))
		}
		ms, h, pi = ms+f.AimT[j], h+int64(f.H[j]), pi+int64(f.P[j])
		j++
		if want := int64((p.TimestampUS - origin) / 1000); ms != want || h != int64(p.YawRaw) || pi != int64(p.PitchRaw) {
			t.Fatalf("visee %d : (t=%d, h=%d, p=%d), attendu (%d, %d, %d)", j-1, ms, h, pi, want, p.YawRaw, p.PitchRaw)
		}
		cap, _ := p.AimHeadingDeg()
		elev, _ := p.AimPitchDeg()
		if math.Abs((float64(h)+0.5)*360/4096-float64(cap)) > 1e-4 ||
			math.Abs((float64(pi)+0.5)*360/2048-180-float64(elev)) > 1e-4 {
			t.Fatalf("visee %d : la conversion publiee ne rend pas l accesseur (%v, %v)", j-1, cap, elev)
		}
	}
	if j != len(f.AimT) {
		t.Fatalf("%d visees publiees, %d dans le film", len(f.AimT), j)
	}
}

// TestLePleinDebitDesBuildsFigesNestPasLaGrille : sur les huit films figes, chaque piste publiee
// porte son plein debit, la somme des colonnes est le compte de la couverture, et ce compte depasse
// nettement celui des points (60 ou 30 records par seconde contre 10 frames). Une publication
// retombee sur la decimation par frame rendrait un rapport de 1.
func TestLePleinDebitDesBuildsFigesNestPasLaGrille(t *testing.T) {
	for _, b := range goldenBuilds() {
		t.Run(b.Build+"/"+b.Short8, func(t *testing.T) {
			g, entry := chargerGoldenBuild(t, b)
			doc := assemblerGoldenBuild(t, b, g, entry)
			c, somme, visees := doc.Coverage.Tracks, 0, 0
			for _, tr := range doc.Tracks {
				if tr.FullRate == nil {
					t.Fatalf("piste slot %d sans plein debit", tr.Slot)
				}
				somme, visees = somme+len(tr.FullRate.T), visees+len(tr.FullRate.AimT)
			}
			if somme != c.FullRateSamples || visees != c.FullRateAimSamples {
				t.Errorf("colonnes %d / %d, couverture %d / %d", somme, visees, c.FullRateSamples, c.FullRateAimSamples)
			}
			if 2*somme < 5*c.PublishedPoints {
				t.Errorf("%d echantillons pour %d points : rapport < 2,5, la publication suit la grille", somme,
					c.PublishedPoints)
			}
		})
	}
}

// TestLePleinDebitSuitLaDecoupeDesVies : deux vies ecrites sur un meme slot donnent deux pistes,
// chacune avec SON plein debit — aucun echantillon d une vie ne passe dans l autre.
func TestLePleinDebitSuitLaDecoupeDesVies(t *testing.T) {
	pos := positionsA60Hz()
	tracks, cov := decimateTracks(pos, decoupeDesTraces{
		origin: 1_000_000, step: 100_000, minPoints: 1,
		vies: []lifeSpan{{slot: 100, from: 1_000_000, to: 5_000_000, xuid: 111},
			{slot: 100, from: 5_000_001, to: 10_000_000, xuid: 222}},
		fb: fallback.NouveauCompteur(),
	})
	if len(tracks) != 2 {
		t.Fatalf("%d pistes, attendu 2", len(tracks))
	}
	if a, b := len(tracks[0].FullRate.T), len(tracks[1].FullRate.T); a != 120 || b != len(pos)-120 {
		t.Errorf("plein debit %d + %d, attendu 120 + %d", a, b, len(pos)-120)
	}
	if tracks[1].FullRate.T[0] != 8_000 || len(tracks[1].FullRate.Gaps) != 0 {
		t.Errorf("la seconde vie s ouvre a t=%d ms avec les lacunes %v ; attendu 8000 et aucune (une vie neuve "+
			"n est pas une lacune)", tracks[1].FullRate.T[0], tracks[1].FullRate.Gaps)
	}
	if cov.FullRateSamples != len(pos) {
		t.Errorf("couverture %d, attendu %d", cov.FullRateSamples, len(pos))
	}
}
