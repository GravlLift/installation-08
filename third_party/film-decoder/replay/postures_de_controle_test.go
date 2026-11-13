package replay

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/internal/grammar"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

// pointDeVie : un instant (ms) et une position (unites monde).
type pointDeVie struct {
	ms      int64
	x, y, z float64
}

// pisteDuPleinDebit encode des echantillons absolus en colonnes differentielles.
func pisteDuPleinDebit(es []pointDeVie) *FullRateTrack {
	fr := &FullRateTrack{}
	var t int64
	var x, y, z int32
	for _, e := range es {
		nx, ny, nz := centiemes(float32(e.x)), centiemes(float32(e.y)), centiemes(float32(e.z))
		fr.T, fr.X, fr.Y, fr.Z = append(fr.T, e.ms-t), append(fr.X, nx-x), append(fr.Y, ny-y), append(fr.Z, nz-z)
		t, x, y, z = e.ms, nx, ny, nz
	}
	return fr
}

// course rend une vie echantillonnee toutes les 16 ms de 0 a `finMS`, dont la vitesse au sol et la
// vitesse verticale sont donnees par instant.
func course(finMS int64, vitesse func(ms int64) (sol, vz float64)) []pointDeVie {
	var out []pointDeVie
	var x, z float64
	for ms := int64(0); ms <= finMS; ms += 16 {
		out = append(out, pointDeVie{ms: ms, x: x, z: 10 + z})
		sol, vz := vitesse(ms)
		x += sol * 0.016
		z += vz * 0.016
	}
	return out
}

// contexteDeTest pose une vie (slot 7, joueur 3, place 2) qui sprinte de 0 a 1 s.
func contexteDeTest(es []pointDeVie) *posturesDeControle {
	tr := Track{Slot: 7, StartFrame: 0, EndFrame: 60, FullRate: pisteDuPleinDebit(es)}
	occ := occupantsPlats(map[uint32]int{7: 3})
	horloge := replayClock{origin: 0, step: 100_000, frames: 100}
	places := lirePlacesDeControle([]grammar.FireEvent{tirDePlace(2, 7, 10)}, occ, horloge,
		map[int][2]int{3: {0, 60}}, true)
	return &posturesDeControle{places: places, occ: occ, horloge: horloge, tracks: []Track{tr},
		viesParSlot: map[uint32][]int{7: {0}}, lues: map[int]bool{},
		sprints: map[uint32][][2]uint64{7: {{0, 1_000_000}}}, montees: map[uint32][][2]int{},
		cin: map[int]cinematique{}, cov: &ControlStanceCoverage{Read: true}}
}

// TestLireLesCommandes : pressions, relachements, impulsions du saut et silence.
func TestLireLesCommandes(t *testing.T) {
	c := func(ts uint64, b uint8) types.ControlInputChange {
		return types.ControlInputChange{Index: 2, TimestampUS: ts, Buttons: b}
	}
	ch := []types.ControlInputChange{
		c(100, 0), c(200, types.ControlButtonCrouch), c(300, types.ControlButtonCrouch|types.ControlButtonJump),
		c(320, types.ControlButtonCrouch), c(400, 0), c(500, types.ControlButtonCrouch),
		{Index: 2, TimestampUS: 600, Unknown: true}, // silence : la pression se ferme a la derniere entree lue
		c(1000, types.ControlButtonJump), {Index: 2, TimestampUS: 1100, Unknown: true},
	}
	cmd := lireLesCommandes(ch)[2]
	if len(cmd.pressions) != 2 || cmd.pressions[0] != (pressionLue{200, 400}) || cmd.pressions[1] != (pressionLue{500, 600}) {
		t.Fatalf("pressions = %+v", cmd.pressions)
	}
	if len(cmd.sauts) != 2 || cmd.sauts[0] != 300 || cmd.sauts[1] != 1000 {
		t.Fatalf("sauts = %v", cmd.sauts)
	}
	if !cmd.connuA(550) || cmd.connuA(800) || !cmd.connuA(1050) {
		t.Fatalf("intervalles connus = %v", cmd.connus)
	}
}

// TestPostureGlissadeEtAccroupi : une pression pendant le sprint glisse jusqu a ce que la vitesse
// retombe ; une pression loin de tout sprint est un accroupi, de la pression au relachement.
func TestPostureGlissadeEtAccroupi(t *testing.T) {
	es := course(5000, func(ms int64) (float64, float64) {
		if ms < 1500 {
			return 3.5, 0
		}
		return 1.0, 0
	})
	p := contexteDeTest(es)
	cmd := &commandesDUnePlace{}
	glissade := p.poser(pressionLue{de: 500_000, a: 600_000}, cmd, 0)
	if len(glissade) != 1 || glissade[0].Kind != types.MovementSlide {
		t.Fatalf("glissade = %+v", glissade)
	}
	if fin := *glissade[0].Ms1; *glissade[0].Ms0 != 500 || fin < 1400 || fin > 1520 {
		t.Fatalf("glissade [%d, %d], attendu [500, ~1450]", *glissade[0].Ms0, fin)
	}
	accroupi := p.poser(pressionLue{de: 3_000_000, a: 3_200_000}, cmd, 0)
	if len(accroupi) != 1 || accroupi[0].Kind != types.MovementCrouch || *accroupi[0].Ms0 != 3000 || *accroupi[0].Ms1 != 3200 {
		t.Fatalf("accroupi = %+v", accroupi)
	}
	if accroupi[0].T0 != 30 || accroupi[0].T1 != 32 {
		t.Fatalf("frames de l accroupi = %d, %d", accroupi[0].T0, accroupi[0].T1)
	}
	if p.cov.Slides != 1 || p.cov.Crouches != 1 || p.cov.SlideEnds[finParLaVitesse] != 1 {
		t.Fatalf("couverture = %+v", *p.cov)
	}
}

// TestPostureGlissadeCoupeeParLeSautPuisAccroupi : un saut coupe la glissade ; le bouton tenu au-dela
// la prolonge en accroupi jusqu au relachement.
func TestPostureGlissadeCoupeeParLeSautPuisAccroupi(t *testing.T) {
	p := contexteDeTest(course(5000, func(int64) (float64, float64) { return 3.5, 0 }))
	cmd := &commandesDUnePlace{sauts: []uint64{900_000}}
	out := p.poser(pressionLue{de: 500_000, a: 1_200_000}, cmd, 0)
	if len(out) != 2 || out[0].Kind != types.MovementSlide || *out[0].Ms1 != 900 ||
		out[1].Kind != types.MovementCrouch || *out[1].Ms0 != 900 || *out[1].Ms1 != 1200 {
		t.Fatalf("postures = %+v", out)
	}
	if p.cov.SlideEnds[finParLeSaut] != 1 || p.cov.CrouchesAfterSlide != 1 {
		t.Fatalf("couverture = %+v", *p.cov)
	}
}

// TestPostureGlissadeALAtterrissage : une pression en l air, a moins de 1,5 s d un sprint, glisse a
// partir du contact au sol.
func TestPostureGlissadeALAtterrissage(t *testing.T) {
	es := course(5000, func(ms int64) (float64, float64) {
		if ms >= 1700 && ms < 2000 {
			return 3.5, -1.5
		}
		return 3.5, 0
	})
	p := contexteDeTest(es)
	out := p.poser(pressionLue{de: 1_800_000, a: 1_850_000}, &commandesDUnePlace{}, 0)
	if len(out) != 1 || out[0].Kind != types.MovementSlide || *out[0].Ms0 < 1900 || *out[0].Ms0 > 2000 {
		t.Fatalf("postures = %+v", out)
	}
	if p.cov.SlidesAfterFall != 1 {
		t.Fatalf("couverture = %+v", *p.cov)
	}
}

// TestResoudreLaVieDUnePlace : une commande se pose sur la vie du joueur qui tient la place ; une place
// sans joueur, ou une vie en vehicule, l ecartent et le comptent.
func TestResoudreLaVieDUnePlace(t *testing.T) {
	p := contexteDeTest(course(5000, func(int64) (float64, float64) { return 1, 0 }))
	if ti, ok := p.resoudre(2, 1_000_000); !ok || ti != 0 {
		t.Fatalf("resoudre(place 2) = %d, %v", ti, ok)
	}
	if _, ok := p.resoudre(4, 1_000_000); ok || p.cov.NoPlayer != 1 {
		t.Fatalf("une place sans joueur doit etre ecartee : %+v", *p.cov)
	}
	p.montees[7] = [][2]int{{20, 30}}
	if _, ok := p.resoudre(2, 2_500_000); ok || p.cov.InVehicle != 1 {
		t.Fatalf("une vie en vehicule doit etre ecartee : %+v", *p.cov)
	}
}
