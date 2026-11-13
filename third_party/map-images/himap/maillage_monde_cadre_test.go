package himap

import "testing"

// TestCadreMaillage : une instance qui touche le cadre, même par un bord, est gardée ; une instance
// entièrement dehors (sur un seul axe suffit) est écartée et comptée ; un cadre vide garde tout.
func TestCadreMaillage(t *testing.T) {
	boite := func(x0, y0, x1, y1 float64) Instance {
		return Instance{AABBMin: [3]float64{x0, y0, -5}, AABBMax: [3]float64{x1, y1, 5}}
	}
	bsp := BSPInstances{Instances: []Instance{
		boite(0, 0, 10, 10),        // dedans
		boite(95, 95, 300, 300),    // déborde, touche le cadre
		boite(100, -20, 120, -10),  // touche le coin par ses bords
		boite(500, 0, 600, 10),     // dehors en x
		boite(0, -400, 10, -300),   // dehors en y
		boite(-2000, 40, 2000, 60), // bande lointaine qui traverse le cadre en x
	}}
	garde, ecartees := bsp.dansCadre([4]float64{-10, -10, 100, 100})
	if len(garde.Instances) != 4 || ecartees != 2 {
		t.Fatalf("gardées %d, écartées %d ; attendu 4 et 2", len(garde.Instances), ecartees)
	}
	if len(bsp.Instances) != 6 {
		t.Fatalf("le bsp d'origine a été modifié : %d instances", len(bsp.Instances))
	}
	for _, vide := range [][4]float64{{}, {10, 10, 10, 20}, {10, 10, 0, 0}} {
		if g, n := bsp.dansCadre(vide); len(g.Instances) != 6 || n != 0 {
			t.Errorf("cadre vide %v : gardées %d, écartées %d", vide, len(g.Instances), n)
		}
	}
}

// TestAjouteMiroir : une pose miroir (echelle negative) inverse l'ordre des sommets de chaque
// triangle, une pose directe le garde.
func TestAjouteMiroir(t *testing.T) {
	m := &Mesh{Vertices: [][3]float64{{0, 0, 0}, {1, 0, 0}, {0, 1, 0}}, Triangles: [][3]int{{0, 1, 2}}}
	for _, c := range []struct {
		echelle float64
		attendu []uint32
	}{{1, []uint32{0, 1, 2}}, {-1, []uint32{0, 2, 1}}} {
		in := PlacementScenario{Echelle: c.echelle}.Instance()
		var g GroupeMaillage
		g.ajoute(m, in, 0)
		if got := g.Indices[0]; len(got) != 3 || got[0] != c.attendu[0] || got[1] != c.attendu[1] || got[2] != c.attendu[2] {
			t.Errorf("echelle %v : indices %v, attendu %v", c.echelle, got, c.attendu)
		}
	}
}
