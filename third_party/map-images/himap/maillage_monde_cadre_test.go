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

// TestCadreMaillageVista : en plus des instances de `dansCadre`, on garde le lointain au-dela
// du rayon du cadre (ici 440 unites du centre [45, 45, 0]) : les montagnes de l'horizon ; on
// ecarte ce qui est plus loin, sur un axe ou sur les trois.
func TestCadreMaillageVista(t *testing.T) {
	boite := func(x0, y0, z0, x1, y1, z1 float64) Instance {
		return Instance{AABBMin: [3]float64{x0, y0, z0}, AABBMax: [3]float64{x1, y1, z1}}
	}
	// cadre [-10,-10,100,100] : centre [45,45], plus grand cote 110, rayon max(300, 440) = 440.
	bsp := BSPInstances{Instances: []Instance{
		boite(0, 0, -5, 10, 10, 5),        // dedans : gardée
		boite(95, 95, -5, 300, 300, 5),    // déborde, touche le cadre : gardée
		boite(440, 40, 0, 460, 50, 100),   // au-dela du cadre à 395 unites du centre : gardée (horizon)
		boite(40, 40, 100, 50, 50, 200),   // dans le cadre en xy, haute en z : gardée
		boite(200, 200, 100, 210, 210, 200), // au-dela du cadre à 219 unites, en l'air : gardée
		boite(600, 40, 0, 700, 50, 100),   // à 555 unites : écartée
		boite(40, -600, 0, 50, -590, 100), // à 635 unites : écartée
	}}
	garde, ecartees := bsp.dansCadreVista([4]float64{-10, -10, 100, 100})
	if len(garde.Instances) != 5 || ecartees != 2 {
		t.Fatalf("gardées %d, écartées %d ; attendu 5 et 2", len(garde.Instances), ecartees)
	}
	for _, vide := range [][4]float64{{}, {10, 10, 10, 20}, {10, 10, 0, 0}} {
		if g, n := bsp.dansCadreVista(vide); len(g.Instances) != 7 || n != 0 {
			t.Errorf("cadre vide %v : gardées %d, écartées %d", vide, len(g.Instances), n)
		}
	}
}

// TestRayonVista : le rayon est quatre fois le plus grand cote du cadre, avec un plancher
// de 300 unites pour les cadres petits.
func TestRayonVista(t *testing.T) {
	for _, c := range []struct {
		cadre   [4]float64
		attendu float64
	}{{[4]float64{0, 0, 100, 200}, 800}, {[4]float64{0, 0, 1000, 10}, 4000}, {[4]float64{0, 0, 80, 80}, 320}, {[4]float64{2, 4, 6, 8}, 300}} {
		if got := rayonVista(c.cadre); got != c.attendu {
			t.Errorf("cadre %v : rayon %v, attendu %v", c.cadre, got, c.attendu)
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
