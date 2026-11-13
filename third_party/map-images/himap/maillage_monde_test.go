package himap

import (
	"testing"
)

// TestGroupeMaillageAjoute verifie la garde de collecte `GroupeMaillage.ajoute` — la brique que
// `CollecteMaillageMonde` pose pour CHAQUE structure du module (la regle generale de collecte
// du sol, 2026-11-12) — sans ouvrir de fichier de jeu : les sommets et les boites d'instance
// sont faits a la main.
//
//  1. Un triangle dont un sommet deborde la boite monde de son instance est ecarte entier
//     (sa part de materiau disparait des indices, rien d'autre), et le compte est rendu.
//  2. Une pose miroir (base au determinant negatif) retourne les faces : le triangle sort
//     a l'envers par rapport a son maillage local, mais reste un triangle de la structure.
func TestGroupeMaillageAjoute(t *testing.T) {
	maillage := &Mesh{
		Vertices:  [][3]float64{{0, 0, 0}, {2, 0, 0}, {0, 2, 0}},
		Triangles: [][3]int{{0, 1, 2}},
		Parts:     []PartMaillage{{Materiau: 0, Debut: 0, Compte: 1}},
	}

	// Pose droite : base orientee (avant x gauche = -haut), echelle 1, le sommet (2,0,0) du
	// maillage tombe a (2,0,0) — a la limite de la boite [0,2]x[0,2] de l'instance : le
	// triangle entre, rien n'est ecarte.
	droite := Instance{
		Scale:     [3]float64{1, 1, 1},
		Position:  [3]float64{0, 0, 0},
		Forward:   [3]float64{1, 0, 0},
		Left:      [3]float64{0, 1, 0},
		Up:        [3]float64{0, 0, 1},
		AABBMin:   [3]float64{0, 0, 0},
		AABBMax:   [3]float64{2, 2, 1},
		Materiaux: []uint32{0xAA},
	}
	g := &GroupeMaillage{}
	ecartes := g.ajoute(maillage, droite, 0)
	if ecartes != 0 {
		t.Fatalf("ecartes = %d, attendu 0 (triangle entier dans la boite)", ecartes)
	}
	if g.Triangles() != 1 {
		t.Fatalf("triangles = %d, attendu 1 (triangle entier dans la boite)", g.Triangles())
	}

	// Meme maillage, meme pose, mais la boite couvRE le triangle : tout entre dans la structure,
	// sur le materiau de l'instance.
	droite.AABBMin = [3]float64{0, 0, 0}
	droite.AABBMax = [3]float64{4, 4, 1}
	g = &GroupeMaillage{}
	if ecartes := g.ajoute(maillage, droite, 0); ecartes != 0 {
		t.Fatalf("ecartes = %d, attendu 0", ecartes)
	}
	if g.Triangles() != 1 {
		t.Fatalf("triangles = %d, attendu 1", g.Triangles())
	}
	if ix := g.Indices[0xAA]; len(ix) != 3 {
		t.Fatalf("indices du materiau 0xAA = %v, attendu 3 indices", ix)
	}
	// Faces dans l'ordre du maillage local : sommets 0 (origine), 1 (avant), 2 (gauche).
	if lo, hi, ok := g.Borne(); !ok || lo[0] != 0 || lo[1] != 0 || hi[0] != 2 || hi[1] != 2 {
		t.Fatalf("borne = %v..%v ok=%v, attendu [0,0,0]..[2,2,0]", lo, hi, ok)
	}

	// Pose miroir : la meme base a gauche et avant echanges (determinant negatif). Le maillage
	// local est retourne par la pose : la face, lue dans le repere monde, doit porter la meme
	// orientation que dans le repere local — c'est le contrat de la garde miroir de `ajoute`.
	miroir := droite
	miroir.Forward = [3]float64{0, 1, 0}
	miroir.Left = [3]float64{1, 0, 0}
	if !miroir.miroir() {
		t.Fatal("miroir : la base echangee doit etre reconnue comme retourne l'espace")
	}
	// Pour une face de niveau (z constant), l'orientation se lit par le signe du produit
	// croise des deux aretes (positif = vers le haut dans ce repere). La pose droite (base
	// orientee, echelle 1) est l'identite : l'orientation monde de sa face est l'orientation
	// locale du maillage.
	orientation := func(a, b, c [3]float32) float64 {
		ab, ac := [3]float64{float64(b[0]) - float64(a[0]), float64(b[1]) - float64(a[1]), 0}, [3]float64{float64(c[0]) - float64(a[0]), float64(c[1]) - float64(a[1]), 0}
		return ab[0]*ac[1] - ab[1]*ac[0]
	}
	pDroite := g.Sommets // g porte encore la pose droite (le triangle entre entier, rien n'est ecarte)
	sommeD := func(i uint32) [3]float32 { return [3]float32{pDroite[3*i], pDroite[3*i+1], pDroite[3*i+2]} }
	locale := orientation(sommeD(0), sommeD(1), sommeD(2))
	g = &GroupeMaillage{}
	if ecartes := g.ajoute(maillage, miroir, 0); ecartes != 0 {
		t.Fatalf("ecartes = %d, attendu 0", ecartes)
	}
	if g.Triangles() != 1 {
		t.Fatalf("triangles = %d, attendu 1", g.Triangles())
	}
	ix := g.Indices[0xAA]
	p := g.Sommets
	somme := func(i uint32) [3]float32 { return [3]float32{p[3*i], p[3*i+1], p[3*i+2]} }
	monde := orientation(somme(ix[0]), somme(ix[1]), somme(ix[2]))
	if monde <= 0 {
		t.Fatalf("orientation monde = %v, attendu positif (la face doit etre retournee par la garde miroir)", monde)
	}
	if monde != locale {
		t.Fatalf("orientation monde = %v, locale = %v : la face doit garder son orientation de repere local", monde, locale)
	}
}

// TestGroupeMaillageAjouteMarge verifie que la marge de bornage elargit la boite de l'instance
// des deux cotes : un sommet a l'interieur de la marge est dedans, au dela il est ecarte.
func TestGroupeMaillageAjouteMarge(t *testing.T) {
	maillage := &Mesh{
		Vertices:  [][3]float64{{0, 0, 0}, {3, 0, 0}, {0, 3, 0}},
		Triangles: [][3]int{{0, 1, 2}},
		Parts:     []PartMaillage{{Materiau: 0, Debut: 0, Compte: 1}},
	}
	in := Instance{
		Scale:     [3]float64{1, 1, 1},
		Position:  [3]float64{0, 0, 0},
		Forward:   [3]float64{1, 0, 0},
		Left:      [3]float64{0, 1, 0},
		Up:        [3]float64{0, 0, 1},
		AABBMin:   [3]float64{0, 0, 0},
		AABBMax:   [3]float64{2, 2, 1},
		Materiaux: []uint32{0x1},
	}
	// Marge 1 : la boite couvRE (3,3,0) ; le triangle entre entier.
	g := &GroupeMaillage{}
	if ecartes := g.ajoute(maillage, in, 1.0); ecartes != 0 || g.Triangles() != 1 {
		t.Fatalf("marge 1 : ecartes=%d triangles=%d, attendu 0/1", ecartes, g.Triangles())
	}
	// Marge 0 : (3,3,0) deborde de (2,2,1) ; le triangle est ecarte.
	g = &GroupeMaillage{}
	if ecartes := g.ajoute(maillage, in, 0); ecartes != 1 || g.Triangles() != 0 {
		t.Fatalf("marge 0 : ecartes=%d triangles=%d, attendu 1/0", ecartes, g.Triangles())
	}
}

// TestDansCadreMultiStructure verifie la regle generale de collecte du sol : un module porte
// plusieurs structures (les tags sbsp que le scenario nomme), et le sol a l'exterieur de
// l'arene ne tient dans AUCUNE seule des boites — il faut donc collecter CHAQUE structure,
// pas seulement celle retenue par les ancres. Le cadre de bornage est applique a chacune
// (2026-11-12, Live Fire : le sol exterieur etait dans les instances jetees).
func TestDansCadreMultiStructure(t *testing.T) {
	// bspJoue : la boite de l'arene, comme sur les cartes temoins (cf. choix_bsp.go).
	joue := BSPInstances{
		GlobalID: 0x1111,
		Bounds:   Bounds{Min: [3]float64{0, 0, 0}, Max: [3]float64{64, 64, 8}},
		Instances: []Instance{
			instanceBoite(0x1, [3]float64{10, 10, 0}, [3]float64{20, 20, 4}),
		},
	}
	// bspSol : la structure du sol exterieur, dont la boite touche l'arene sans la contenir —
	// les ancres ne la designent jamais (aucune ancre a l'interieur), et l'ancienne regle la
	// jetait.
	sol := BSPInstances{
		GlobalID: 0x2222,
		Bounds:   Bounds{Min: [3]float64{30, 30, 0}, Max: [3]float64{120, 120, 4}},
		Instances: []Instance{
			instanceBoite(0x2, [3]float64{60, 60, 0}, [3]float64{90, 90, 2}),
		},
	}
	ancres := [][3]float64{{20, 20, 1}, {40, 40, 1}}
	if retenu := ChoisitBSP([]BSPInstances{joue, sol}, ancres); retenu.GlobalID != 0x1111 {
		t.Fatalf("bsp retenu = %x, attendu l'arene 0x1111", retenu.GlobalID)
	}

	// Sans cadre : les deux structures sont entieres, aucune instance n'est ecartee.
	if red, n := joue.dansCadre([4]float64{}); n != 0 || len(red.Instances) != 1 {
		t.Fatalf("cadre vide : %d instances, %d ecartees, attendu 1/0", len(red.Instances), n)
	}
	if red, n := sol.dansCadre([4]float64{}); n != 0 || len(red.Instances) != 1 {
		t.Fatalf("cadre vide (sol) : %d instances, %d ecartees, attendu 1/0", len(red.Instances), n)
	}
	// Cadre sur l'arene : l'instance du sol, a (60..90), touche le cadre (la garde est
	// INCLUSIVE aux bords) — le sol qui longera l'arene reste collecte, c'est l'objet de la
	// regle generale de collecte du sol.
	if red, n := sol.dansCadre([4]float64{0, 0, 64, 64}); n != 0 || len(red.Instances) != 1 {
		t.Fatalf("cadre arene : %d instances, %d ecartees, attendu 1/0 (garde inclusive)", len(red.Instances), n)
	}
	// Cadre serre a l'interieur de l'arene : l'instance du sol, a (60..90), est a l'exterieur
	// du cadre et est ecartee.
	if red, n := sol.dansCadre([4]float64{0, 0, 40, 40}); n != 1 || len(red.Instances) != 0 {
		t.Fatalf("cadre serre : %d instances, %d ecartees, attendu 0/1", len(red.Instances), n)
	}
	// Cadre large : les deux structures gardent leurs instances.
	if red, n := sol.dansCadre([4]float64{0, 0, 200, 200}); n != 0 || len(red.Instances) != 1 {
		t.Fatalf("cadre large : %d instances, %d ecartees, attendu 1/0", len(red.Instances), n)
	}
}

// TestEstNomme verifie la regle de collecte par scenario : une structure est collectee si le
// scenario (levl) la nomme. Un scenario illisible (nil) ne nomme aucune structure : on ne
// collecte que le bsp joue (repli).
func TestEstNomme(t *testing.T) {
	// Scenario lisible : les structures 0x1111, 0x2222, 0x3333 sont nommees.
	nommes := map[uint32]bool{0x1111: true, 0x2222: true, 0x3333: true}
	if !estNomme(0x1111, nommes) || !estNomme(0x2222, nommes) || !estNomme(0x3333, nommes) {
		t.Fatal("structures nommees : 0x1111, 0x2222, 0x3333 doivent etre reconnues")
	}
	if estNomme(0x4444, nommes) {
		t.Fatal("structure 0x4444 non nommee : doit etre rejetee")
	}
	// Scenario illisible (nil) : aucune structure n'est nommee, on ne collecte que le bsp joue.
	if estNomme(0x1111, nil) {
		t.Fatal("scenario illisible : aucune structure ne doit etre nommee")
	}
	// Ensemble vide : meme repli que nil.
	if estNomme(0x1111, map[uint32]bool{}) {
		t.Fatal("ensemble vide : aucune structure ne doit etre nommee")
	}
}

// instanceBoite fait une instance identité dont la boite monde est [lo, hi].
func instanceBoite(rang int, lo, hi [3]float64) Instance {
	in := Instance{
		Index:     rang,
		Scale:     [3]float64{1, 1, 1},
		Forward:   [3]float64{1, 0, 0},
		Left:      [3]float64{0, 1, 0},
		Up:        [3]float64{0, 0, 1},
		AABBMin:   lo,
		AABBMax:   hi,
		Materiaux: []uint32{uint32(rang)},
	}
	return in
}
