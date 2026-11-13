//go:build gamefiles

package himap

import "testing"

// TestLumieresRecharge : 113 lumieres dans le `stlm` de Recharge, dont le soleil remplace par le
// `dwsg` : restent 17 omni et 95 projecteurs, toutes avec une portee et une couleur.
func TestLumieresRecharge(t *testing.T) {
	ls, err := LitLumieres(sourcesRecharge(t))
	if err != nil {
		t.Fatal(err)
	}
	par := map[TypeLumiere]int{}
	for _, l := range ls {
		par[l.Type]++
		if l.Portee <= 0 || l.Couleur == [3]float64{} {
			t.Errorf("lumiere sans portee ou sans couleur : %+v", l)
		}
	}
	if len(ls) != 112 || par[LumiereOmni] != 17 || par[LumiereProjecteur] != 95 {
		t.Fatalf("%d lumieres, par type %v ; attendu 112 (17 omni, 95 projecteurs)", len(ls), par)
	}
}
