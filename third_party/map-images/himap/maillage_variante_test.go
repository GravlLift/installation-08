package himap

import (
	"math"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// TestEcartDeVariante : un volume de mort et un objet a forme sont des volumes de jeu ; un objet
// du mode Infection est ecarte d'une partie sans mode ; un objet sans forme se pose,
// `infection_exclude` compris.
func TestEcartDeVariante(t *testing.T) {
	var mort int32
	for ty := range TypesVolumesDeMort {
		mort = ty
		break
	}
	cas := []struct {
		nom  string
		o    mapvar.Object
		veut ecartVariante
	}{
		{"caisse", mapvar.Object{TypeID: 1606981455}, posable},
		{"volume de mort", mapvar.Object{TypeID: mort}, ecartVolumeDeMort},
		{"volume de mort avec forme", mapvar.Object{TypeID: mort, ShapeRaw: &mapvar.ShapeRaw{Family: 2}}, ecartVolumeDeMort},
		{"zone", mapvar.Object{TypeID: 95146865, ShapeRaw: &mapvar.ShapeRaw{Family: 3}}, ecartVolume},
		{"repere de reapparition", mapvar.Object{TypeID: -1533673853, Flags: 7}, ecartRepere},
		{"accessoire", mapvar.Object{TypeID: 1739378636, Flags: 21}, posable},
		{"porte d'Infection", mapvar.Object{TypeID: 1282914177, Flags: 1, Labels: []int32{mapvar.LabelHash(mapvar.LabelInfectionInclude)}}, ecartHorsMode},
		{"caisse d'Infection parmi d'autres labels", mapvar.Object{TypeID: 1006238451, Flags: 1,
			Labels: []int32{mapvar.LabelHash("assault_exclude"), mapvar.LabelHash(mapvar.LabelInfectionInclude)}}, ecartHorsMode},
		{"grille hors Infection", mapvar.Object{TypeID: 1233051095, Flags: 1, Labels: []int32{mapvar.LabelHash("infection_exclude")}}, posable},
	}
	for _, c := range cas {
		if got := ecartDeVariante(c.o, FiltresMode{}); got != c.veut {
			t.Errorf("%s : %d, attendu %d", c.nom, got, c.veut)
		}
	}
}

// TestPaletteApres : la palette retenue est la premiere qui suit le rtgo demande, jamais celle
// d'un autre rtgo du meme food.
func TestPaletteApres(t *testing.T) {
	groupes := map[uint32]string{
		1: "food", 2: GroupeRtgo, 3: "scgt", 4: GroupePalette, 5: GroupePalette,
		6: GroupeRtgo, 7: "scgt", 8: GroupePalette, 9: "bloc",
	}
	groupe := func(h uint32) string { return groupes[h] }
	refs := []uint32{1, 9, 2, 3, 4, 5, 6, 7, 8}
	cas := []struct {
		rtgo uint32
		veut uint32
		ok   bool
	}{
		{2, 4, true},
		{6, 8, true},
		{42, 0, false},
	}
	for _, c := range cas {
		got, ok := paletteApres(refs, groupe, c.rtgo)
		if got != c.veut || ok != c.ok {
			t.Errorf("rtgo %d : (%d, %v), attendu (%d, %v)", c.rtgo, got, ok, c.veut, c.ok)
		}
	}
	if _, ok := paletteApres([]uint32{4, 2, 3}, groupe, 2); ok {
		t.Error("une palette placee avant le rtgo ne doit pas etre retenue")
	}
}

// TestInstanceVariante : la pose garde la position et la base de l'objet, porte la liste de
// materiaux, et sa boite illimitee ne fait ecarter aucun triangle.
func TestInstanceVariante(t *testing.T) {
	o := mapvar.Object{
		Pos:     mapvar.Vec3{X: 27.7, Y: -3.6, Z: 2.2},
		Up:      mapvar.Vec3{Z: 1},
		Forward: mapvar.Vec3{Y: 2},
	}
	in := instanceVariante(o, []uint32{0xA, 0xB}, 0)
	if in.Position != [3]float64{27.7, -3.6, 2.2} {
		t.Errorf("position %v", in.Position)
	}
	o.Scale = &mapvar.Vec3{X: 1, Y: 1, Z: 2}
	if p := instanceVariante(o, nil, 0.4).Position; math.Abs(p[2]-3.0) > 1e-9 {
		t.Errorf("socle leve a l'echelle : z %v, attendu 3,0", p[2])
	}
	if in.Forward != [3]float64{0, 1, 0} || in.Left != [3]float64{-1, 0, 0} {
		t.Errorf("base avant %v gauche %v", in.Forward, in.Left)
	}
	if len(in.Materiaux) != 2 || in.Materiaux[1] != 0xB {
		t.Errorf("materiaux %v", in.Materiaux)
	}
	if !math.IsInf(in.AABBMax[0], 1) || !math.IsInf(in.AABBMin[2], -1) {
		t.Errorf("boite %v %v", in.AABBMin, in.AABBMax)
	}
	m := &Mesh{
		Vertices:  [][3]float64{{0, 0, 0}, {100, 0, 0}, {0, 100, 0}},
		Triangles: [][3]int{{0, 1, 2}},
		Parts:     []PartMaillage{{Materiau: 1, Debut: 0, Compte: 1}},
	}
	var g GroupeMaillage
	if ecartes := g.ajoute(m, in, 0); ecartes != 0 {
		t.Fatalf("%d triangle(s) ecarte(s) par la boite", ecartes)
	}
	if len(g.Indices[0xB]) != 3 {
		t.Errorf("triangle range sous %v, attendu le materiau de rang 1", g.Indices)
	}
}

// TestInstanceForgeEchelle : l'echelle de l'objet s'applique par axe local (avant, gauche,
// haut) ; sans elle, l'objet garde l'echelle unitaire.
func TestInstanceForgeEchelle(t *testing.T) {
	o := mapvar.Object{Up: mapvar.Vec3{Z: 1}, Forward: mapvar.Vec3{Y: 1}, Scale: &mapvar.Vec3{X: 2, Y: 3, Z: 4}}
	if w := InstanceForge(o).LocalToWorld([3]float64{1, 1, 1}); w != [3]float64{-3, 2, 4} {
		t.Fatalf("pose mise a l'echelle %v", w)
	}
	o.Scale = nil
	if s := InstanceForge(o).Scale; s != [3]float64{1, 1, 1} {
		t.Fatalf("echelle par defaut %v", s)
	}
}

// TestCompteEcart : chaque ecart se compte a sa ligne du bilan ; un objet posable ne compte rien.
func TestCompteEcart(t *testing.T) {
	var b BilanVariante
	for _, e := range []ecartVariante{ecartVolumeDeMort, ecartVolume, ecartRepere, ecartRepere, ecartHorsMode} {
		if compteEcart(e, &b) {
			t.Errorf("ecart %d rendu posable", e)
		}
	}
	if !compteEcart(posable, &b) {
		t.Error("posable rendu ecarte")
	}
	if b.VolumesDeMort != 1 || b.Volumes != 1 || b.Reperes != 2 || b.HorsMode != 1 {
		t.Errorf("bilan %+v", b)
	}
}

// TestPoseVarianteInfection : l'objet du mode Infection n'est pas pose dans une partie sans mode
// et se compte a sa ligne ; son contraire (`infection_exclude`) et l'objet sans label vont
// jusqu'au modele (absent ici).
func TestPoseVarianteInfection(t *testing.T) {
	objets := []mapvar.Object{
		{TypeID: 1282914177, Flags: 1, Labels: []int32{mapvar.LabelHash(mapvar.LabelInfectionInclude)}},
		{TypeID: 1233051095, Flags: 1, Labels: []int32{mapvar.LabelHash("infection_exclude")}},
		{TypeID: 1606981455, Flags: 1},
	}
	var m MaillageMonde
	var b BilanVariante
	if poses := m.poseVarianteTeinte(OptionsVariante{Objets: objets}, nil, nil, &b); len(poses) != 0 {
		t.Fatalf("poses %v sans modele", poses)
	}
	if b.HorsMode != 1 || b.SansModele != 2 || b.Poses != 0 {
		t.Fatalf("bilan %+v, attendu 1 objet d'Infection et 2 sans modele", b)
	}
}

// TestObjetsPublies : la boite d'un objet couvre ses sommets ; la table publiee porte rang, type et
// boite, et rien sans objet.
func TestObjetsPublies(t *testing.T) {
	mn, mx, ok := boiteDesSommets([]float32{1, 5, -2, 3, 0, 4})
	if !ok || mn != [3]float64{1, 0, -2} || mx != [3]float64{3, 5, 4} {
		t.Fatalf("boite %v %v %v", mn, mx, ok)
	}
	if _, _, ok := boiteDesSommets(nil); ok {
		t.Error("boite sans sommet")
	}
	if mn, mx := uneBoite([3]float64{0, 0, 0}, [3]float64{1, 1, 1}, [3]float64{-1, 2, 0}, [3]float64{0, 3, 0}); mn != [3]float64{-1, 0, 0} || mx != [3]float64{1, 3, 1} {
		t.Errorf("union %v %v", mn, mx)
	}
	if extrasObjets(nil) != nil {
		t.Error("table publiee sans objet")
	}
	l := extrasObjets([]ObjetPose{{Index: 11, Type: 1739378636, Min: mn, Max: mx}})
	if len(l) != 1 || l[0]["index"] != 11 || l[0]["type"] != int32(1739378636) {
		t.Errorf("table %v", l)
	}
}

// TestTousMateriaux : une liste n'est une palette que si chaque reference est un materiau.
func TestTousMateriaux(t *testing.T) {
	estMat := func(h uint32) bool { return h != 0 }
	if !tousMateriaux([]uint32{1, 2}, estMat) || tousMateriaux([]uint32{1, 0}, estMat) {
		t.Error("tousMateriaux")
	}
}

// TestResumeTypesPoses : les types sont classes par triangles poses, a egalite par type.
func TestResumeTypesPoses(t *testing.T) {
	poses := map[int32]*typePose{
		5: {typeID: 5, objets: 2, triangles: 10},
		3: {typeID: 3, objets: 1, triangles: 10},
		9: {typeID: 9, objets: 4, triangles: 99},
	}
	if got, veut := resumeTypesPoses(poses), "9:x4:99 3:x1:10 5:x2:10"; got != veut {
		t.Errorf("%q, attendu %q", got, veut)
	}
}
