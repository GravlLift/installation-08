//go:build gamefiles

package himap

import (
	"os"
	"path/filepath"
	"testing"
)

// sourcesRecharge resout la lumiere de l'unique structure de Recharge (sgh_blueprint).
func sourcesRecharge(t *testing.T) SourcesLumiere {
	t.Helper()
	dir, err := LevelsDir("pc")
	if err != nil {
		t.Skip(err)
	}
	chemin := filepath.Join(dir, "sgh_blueprint", "sgh_blueprint-rtx-new.module")
	if _, err := os.Stat(chemin); err != nil {
		t.Skipf("module absent (%s)", chemin)
	}
	bsps, err := ReadModuleInstances(chemin)
	if err != nil || len(bsps) != 1 {
		t.Fatalf("sbsp de Recharge : %d, err=%v", len(bsps), err)
	}
	s, err := SourcesLumiereDe(chemin, chemin, bsps[0].GlobalID)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

// moduleGeometrieTest : le module de geometrie d'une carte installee ; les cartes sans sbsp
// rangent la leur dans le module commun (cf. `moduleGeometrie` des reglages des fonds).
func moduleGeometrieTest(t *testing.T, chemin string) string {
	t.Helper()
	if bsps, err := ReadModuleInstances(chemin); err == nil && len(bsps) > 0 {
		return chemin
	}
	racine, err := DeployRoot()
	if err != nil {
		t.Skip(err)
	}
	return filepath.Join(racine, "pc", "globals", "common-rtx-new.module")
}

// horsRejeu : cartes installees sans fond publie, que le rejeu ne construit pas, et la raison pour
// laquelle leur lumiere ne se lit pas.
var horsRejeu = map[string]string{
	"pve_house": "bitmap des sondes sans bloc de textures",
}

// TestSourcesLumiereCartes : sur chaque carte installee, chaque structure du scenario resout sa
// lumiere ; celle de la plus grande structure (la structure jouee des cartes natives) se lit sans
// erreur : sondes, lumieres posees, soleil. Les autres structures (decor lointain) sont
// seulement journalisees : celle d'Aquarius porte une region sans texture (rang -1).
func TestSourcesLumiereCartes(t *testing.T) {
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
		if err != nil {
			t.Errorf("%s : %v", e.Name(), err)
			continue
		}
		geometrie := moduleGeometrieTest(t, chemin)
		bsps, err := ReadModuleInstances(geometrie)
		if err != nil {
			t.Errorf("%s : %v", e.Name(), err)
			continue
		}
		for _, st := range n.Structures {
			s, err := SourcesLumiereDe(chemin, geometrie, st.BSP)
			if err != nil {
				t.Errorf("%s : %v", e.Name(), err)
				continue
			}
			sondes, aSondes, errS := LitSondes(s)
			lampes, errL := LitLumieres(s)
			soleil, aSoleil, errO := LitSoleil(s)
			if errS != nil || errL != nil || errO != nil {
				signale := t.Logf
				if st.BSP == bsps[0].GlobalID && horsRejeu[e.Name()] == "" { // la plus grande d'abord
					signale = t.Errorf
				}
				signale("%s sbsp %#x : sondes %v, lumieres %v, soleil %v", e.Name(), st.BSP, errS, errL, errO)
				continue
			}
			t.Logf("%-22s sbsp %08x : %2d regions (%v), %4d lumieres, soleil %v %.2f",
				e.Name(), st.BSP, len(sondes.Regions), aSondes, len(lampes), aSoleil, soleil.Intensite)
		}
	}
}
