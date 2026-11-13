//go:build gamefiles

package himap

import (
	"errors"
	"math"
	"os"
	"path/filepath"
	"testing"
)

// TestSoleilRecharge lit le `dwsg` de Recharge (sgh_blueprint) dans l'installation : c'est
// l'ancre de la convention de DirectionSoleil.
func TestSoleilRecharge(t *testing.T) {
	s, ok, err := LitSoleil(sourcesRecharge(t))
	if err != nil || !ok {
		t.Fatalf("soleil de Recharge : ok=%v err=%v", ok, err)
	}
	if !procheDe(s.Direction, soleilRecharge, 0.01) {
		t.Fatalf("Recharge : %v, attendu %v", s.Direction, soleilRecharge)
	}
	if !s.AvecIntensite || s.Intensite != 9 || !s.AvecCouleur {
		t.Fatalf("couleur / intensite de Recharge : %+v", s)
	}
}

// TestSoleilCartes publie le soleil de chaque carte installee (azimut et elevation au sens de
// la visionneuse : atan2(y, x) et asin(z) en axes Halo) et exige une lecture sans erreur.
func TestSoleilCartes(t *testing.T) {
	dir, err := LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	ents, err := os.ReadDir(dir)
	if err != nil {
		t.Skip(err)
	}
	for _, e := range ents {
		chemin := filepath.Join(dir, e.Name(), e.Name()+"-rtx-new.module")
		if _, err := os.Stat(chemin); err != nil {
			continue
		}
		n, err := LitNiveau(chemin)
		if err != nil || len(n.Structures) == 0 {
			t.Errorf("%s : scenario %+v, %v", e.Name(), n, err)
			continue
		}
		src, err := SourcesLumiereDe(chemin, moduleGeometrieTest(t, chemin), n.Structures[0].BSP)
		if err != nil {
			t.Errorf("%s : %v", e.Name(), err)
			continue
		}
		p, err := LitParametresSoleil(src.ModuleEtat, src.EtatDuMonde)
		if errors.Is(err, ErrSansSoleil) {
			t.Logf("%-24s sans soleil dynamique", e.Name())
			continue
		}
		if err != nil {
			t.Errorf("%s : %v", e.Name(), err)
			continue
		}
		s, ok := p.Soleil()
		if !ok {
			t.Logf("%-24s aucun soleil (drapeaux %#x, intensite %.2f, heure %.1f, latitude %.1f, azimut %.1f, saison %.2f)",
				e.Name(), p.Drapeaux, p.Intensite, p.AngleHoraire, p.Latitude, p.Azimut, p.Saison)
			continue
		}
		az := math.Atan2(s.Direction[1], s.Direction[0]) * 180 / math.Pi
		if az < 0 {
			az += 360
		}
		el := math.Asin(s.Direction[2]) * 180 / math.Pi
		t.Logf("%-24s az=%6.1f el=%5.1f dir=(%.3f %.3f %.3f) intensite %.2f (heure %.1f, latitude %.1f, azimut %.1f, saison %.2f)",
			e.Name(), az, el, s.Direction[0], s.Direction[1], s.Direction[2], s.Intensite,
			p.AngleHoraire, p.Latitude, p.Azimut, p.Saison)
	}
}
