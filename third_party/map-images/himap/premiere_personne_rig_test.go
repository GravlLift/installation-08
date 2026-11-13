package himap

import "testing"

// TestPistesSurSquelette : les pistes d'un graphe herite suivent les os du rig par nom ; un os du rig
// absent du graphe herite reste sans piste, une piste d'un os absent du rig disparait.
func TestPistesSurSquelette(t *testing.T) {
	piste := func(x float64) PisteOs { return PisteOs{Translations: [][3]float64{{x, 0, 0}}} }
	c := &ClipAnimation{Images: 1, Os: []PisteOs{piste(1), piste(2), piste(3)}}
	de := []OsGraphe{{Nom: 10}, {Nom: 20}, {Nom: 30}}
	vers := []OsGraphe{{Nom: 30}, {Nom: 40}, {Nom: 10}, {Nom: 50}}
	got := pistesSurSquelette(c, de, vers)
	if len(got.Os) != len(vers) {
		t.Fatalf("%d pistes, attendu %d", len(got.Os), len(vers))
	}
	attendu := []float64{3, -1, 1, -1}
	for i, x := range attendu {
		p := got.Os[i]
		switch {
		case x < 0 && len(p.Translations) != 0:
			t.Errorf("os %d : piste %v, attendu vide", i, p.Translations)
		case x >= 0 && (len(p.Translations) != 1 || p.Translations[0][0] != x):
			t.Errorf("os %d : piste %v, attendu %v", i, p.Translations, x)
		}
	}
	if len(c.Os) != 3 || c.Os[0].Translations[0][0] != 1 {
		t.Error("le clip source a change")
	}
}
