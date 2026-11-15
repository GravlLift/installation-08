package himap

// LOCAL-CHANGE (infinite-theater-3d): tests of maillage_variante_poses.go and glb_poses.go,
// without game files.

import (
	"math"
	"testing"
)

// gltfDe : un point Halo en axes glTF (x, z, -y).
func gltfDe(v [3]float64) [3]float64 { return [3]float64{v[0], v[2], -v[1]} }

// appliqueMatrice applique une matrice glTF (colonnes) a un point.
func appliqueMatrice(m *[16]float32, p [3]float64) [3]float64 {
	var w [3]float64
	for a := range 3 {
		w[a] = float64(m[12+a]) + p[0]*float64(m[a]) + p[1]*float64(m[4+a]) + p[2]*float64(m[8+a])
	}
	return w
}

// TestMatriceGLTF : la matrice d'une pose porte un point local la ou LocalToWorld le porte, en axes
// glTF, echelle non uniforme et pose miroir comprises.
func TestMatriceGLTF(t *testing.T) {
	poses := []Instance{
		{Scale: [3]float64{1, 1, 1}, Position: [3]float64{3, -4, 5}, Forward: [3]float64{1, 0, 0}, Left: [3]float64{0, 1, 0}, Up: [3]float64{0, 0, 1}},
		{Scale: [3]float64{2, 0.5, 3}, Position: [3]float64{-7, 2, 1}, Forward: [3]float64{0, 1, 0}, Left: [3]float64{-1, 0, 0}, Up: [3]float64{0, 0, 1}},
		{Scale: [3]float64{-1, 1, 1}, Position: [3]float64{0, 0, 9}, Forward: [3]float64{0, 0, 1}, Left: [3]float64{0, 1, 0}, Up: [3]float64{-1, 0, 0}},
	}
	for i, in := range poses {
		m := matriceGLTF(in)
		for _, l := range [][3]float64{{0, 0, 0}, {1, 2, 3}, {-0.5, 4, -2}} {
			got := appliqueMatrice(m, gltfDe(l))
			veut := gltfDe(in.LocalToWorld(l))
			for a := range 3 {
				if math.Abs(got[a]-veut[a]) > 1e-5 {
					t.Fatalf("pose %d, point %v : %v, attendu %v", i, l, got, veut)
				}
			}
		}
	}
}

// posesDeTest : une geometrie d'un triangle sous deux cles, et quatre placements : deux identiques,
// un autre materiau, et une piece de kit.
func posesDeTest() *PosesVariante {
	geo := GroupeMaillage{
		Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0},
		Indices: map[uint32][]uint32{1: {0, 1, 2}, 2: {0, 2, 1}},
	}
	for j := range geo.UV {
		geo.UV[j] = make([]float32, 6)
	}
	id := Instance{Scale: [3]float64{1, 1, 1}, Forward: [3]float64{1, 0, 0}, Left: [3]float64{0, 1, 0}, Up: [3]float64{0, 0, 1}}
	loin := id
	loin.Position = [3]float64{10, 0, 0}
	locale := id
	locale.Position = [3]float64{0, 0, 2}
	return &PosesVariante{
		Geometries: []GeometrieVariante{{Maillage: geo}},
		Poses: []PoseVariante{
			{Objet: 0, Parent: id, Materiaux: []uint32{4, 5}},
			{Objet: 1, Parent: loin, Materiaux: []uint32{4, 5}},
			{Objet: 2, Parent: id, Materiaux: []uint32{4, 6}},
			{Objet: 3, Parent: loin, Locale: &locale, Materiaux: []uint32{4, 5}},
		},
	}
}

// TestPosesPartagees : la geometrie s'ecrit une fois ; deux placements aux memes materiaux
// partagent un mesh ; la piece de kit est l'enfant d'un noeud qui porte la pose de son objet, et
// seul ce noeud est une racine.
func TestPosesPartagees(t *testing.T) {
	pv := posesDeTest()
	doc := &gltfDoc{}
	bin := &tamponGLB{}
	ajoutePosesVariante(doc, bin, pv, func(id uint32) int { return int(id) })
	positions := 0
	for _, a := range doc.Accessors {
		if a.Type == "VEC3" {
			positions++
		}
	}
	if positions != 1 {
		t.Errorf("%d accesseurs de sommets, attendu 1 (geometrie ecrite une fois)", positions)
	}
	if len(doc.Meshes) != 2 {
		t.Fatalf("%d meshes, attendu 2 (deux combinaisons de materiaux)", len(doc.Meshes))
	}
	if len(doc.Nodes) != 5 || *doc.Nodes[0].Mesh != *doc.Nodes[1].Mesh || *doc.Nodes[0].Mesh == *doc.Nodes[2].Mesh {
		t.Fatalf("noeuds %+v", doc.Nodes)
	}
	if m := doc.Meshes[*doc.Nodes[2].Mesh]; m.Primitives[1].Material != 6 || m.Primitives[0].Attributes["POSITION"] != doc.Meshes[0].Primitives[0].Attributes["POSITION"] {
		t.Errorf("mesh du troisieme placement %+v", m)
	}
	parent := doc.Nodes[3]
	if parent.Mesh != nil || len(parent.Children) != 1 || parent.Children[0] != 4 || doc.Nodes[4].Name != "structure" {
		t.Errorf("piece de kit : parent %+v, enfant %+v", parent, doc.Nodes[4])
	}
	if r := racinesGLB(doc.Nodes); len(r) != 4 || r[3] != 3 {
		t.Errorf("racines %v", r)
	}
	if poses, uniques := pv.Triangles(); poses != 8 || uniques != 2 {
		t.Errorf("triangles poses %d, uniques %d", poses, uniques)
	}
}

// TestBoitePoses : la boite d'un objet couvre les sommets de ses placements portes dans le monde,
// piece de kit comprise.
func TestBoitePoses(t *testing.T) {
	pv := posesDeTest()
	mn, mx, ok := pv.boite(pv.Poses[3:])
	if !ok || mn != [3]float64{10, 0, 2} || mx != [3]float64{11, 1, 2} {
		t.Fatalf("boite %v %v %v", mn, mx, ok)
	}
	if _, _, ok := pv.boite(nil); ok {
		t.Error("boite sans placement")
	}
}
