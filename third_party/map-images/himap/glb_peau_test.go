package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// squeletteDeDeux : une racine a l'origine et un enfant a 1 u au-dessus (Z Halo), sans rotation.
func squeletteDeDeux() []Noeud {
	id := [3][3]float64{{1, 0, 0}, {0, 1, 0}, {0, 0, 1}}
	return []Noeud{
		{Name: 1, Parent: -1, Quat: [4]float64{0, 0, 0, 1}, Scale: 1, InvAxes: id},
		{Name: 2, Parent: 0, Pos: [3]float64{0, 0, 1}, Quat: [4]float64{0, 0, 0, 1}, Scale: 1, InvAxes: id,
			InvPos: [3]float64{0, 0, -1}},
	}
}

// TestEcritGLBPeau : deux os, trois sommets. Accesseurs JOINTS_0 / WEIGHTS_0 / matrices inverses,
// peau, hierarchie des os, axes glTF.
func TestEcritGLBPeau(t *testing.T) {
	m := &ModeleAPeau{
		Maillage: &MaillageMonde{Structure: GroupeMaillage{
			Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 0, 1},
			Indices: map[uint32][]uint32{0xA: {0, 1, 2}},
		}},
		Noeuds: squeletteDeDeux(),
		Noms:   []string{"b_pedestal", "b_pelvis"},
		Influences: []Influences{
			{Poids: [OsParSommet]float32{1}},
			{Os: [OsParSommet]uint16{0, 1}, Poids: [OsParSommet]float32{0.5, 0.5}},
			{Os: [OsParSommet]uint16{1}, Poids: [OsParSommet]float32{1}},
		},
	}
	var buf bytes.Buffer
	if err := EcritGLBPeau(&buf, m, "test", nil); err != nil {
		t.Fatalf("EcritGLBPeau : %v", err)
	}
	b := buf.Bytes()
	lenJSON := int(binary.LittleEndian.Uint32(b[12:]))
	var doc gltfDoc
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
		t.Fatalf("JSON glTF : %v", err)
	}
	prim := doc.Meshes[0].Primitives[0]
	jo, ok1 := prim.Attributes["JOINTS_0"]
	po, ok2 := prim.Attributes["WEIGHTS_0"]
	if !ok1 || !ok2 {
		t.Fatalf("attributs %v", prim.Attributes)
	}
	if a := doc.Accessors[jo]; a.Type != typeVec4 || a.ComponentType != glComponentU16 || a.Count != 3 {
		t.Fatalf("JOINTS_0 %+v", a)
	}
	if a := doc.Accessors[po]; a.Type != typeVec4 || a.ComponentType != glComponentF32 || a.Count != 3 {
		t.Fatalf("WEIGHTS_0 %+v", a)
	}
	if len(doc.Skins) != 1 {
		t.Fatalf("peaux %+v", doc.Skins)
	}
	sk := doc.Skins[0]
	if len(sk.Joints) != 2 || sk.Joints[0] != 1 || sk.Joints[1] != 2 || sk.Skeleton == nil || *sk.Skeleton != 1 {
		t.Fatalf("peau %+v", sk)
	}
	if a := doc.Accessors[sk.InverseBindMatrices]; a.Type != "MAT4" || a.ComponentType != glComponentF32 || a.Count != 2 {
		t.Fatalf("matrices inverses %+v", a)
	}
	if doc.BufferViews[doc.Accessors[sk.InverseBindMatrices].BufferView].Target != 0 {
		t.Fatal("la vue des matrices inverses ne porte pas de cible")
	}
	maillage, racine, enfant := doc.Nodes[0], doc.Nodes[1], doc.Nodes[2]
	if maillage.Skin == nil || *maillage.Skin != 0 || maillage.Mesh == nil {
		t.Fatalf("noeud du maillage %+v", maillage)
	}
	if racine.Name != "b_pedestal" || racine.Mesh != nil || len(racine.Children) != 1 || racine.Children[0] != 2 {
		t.Fatalf("racine %+v", racine)
	}
	if enfant.Name != "b_pelvis" || enfant.Translation == nil || *enfant.Translation != [3]float32{0, 1, 0} {
		t.Fatalf("enfant %+v (1 u en Z Halo = 1 u en Y glTF)", enfant)
	}
	if len(doc.Scenes[0].Nodes) != 2 || doc.Scenes[0].Nodes[0] != 0 || doc.Scenes[0].Nodes[1] != 1 {
		t.Fatalf("racines de la scene %v", doc.Scenes[0].Nodes)
	}
	data := b[20+lenJSON+8:]
	vue := doc.BufferViews[doc.Accessors[sk.InverseBindMatrices].BufferView]
	var inv [32]float32
	for i := range inv {
		inv[i] = math.Float32frombits(binary.LittleEndian.Uint32(data[vue.ByteOffset+4*i:]))
	}
	if inv[16+13] != -1 || inv[16+0] != 1 || inv[16+5] != 1 || inv[16+10] != 1 {
		t.Fatalf("matrice inverse du second os %v (translation -1 en Y glTF)", inv[16:])
	}
}

// TestMatriceInverseGLTF : une rotation de 90 degres autour de Z Halo devient une rotation autour
// de Y glTF, conjuguee par le changement d'axes.
func TestMatriceInverseGLTF(t *testing.T) {
	n := Noeud{InvAxes: [3][3]float64{{0, 1, 0}, {-1, 0, 0}, {0, 0, 1}}, InvPos: [3]float64{1, 2, 3}}
	got := matriceInverseGLTF(n)
	// Halo : x -> y, y -> -x. glTF (x, z, -y) : x -> -z, z -> x.
	want := [16]float32{0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 3, -2, 1}
	if got != want {
		t.Fatalf("matrice %v, attendu %v", got, want)
	}
}

// TestInfluencesDesTampons : poids 10:10:10 au quatrieme implicite de 1, indices repetes cumules,
// rigide a os sans poids.
func TestInfluencesDesTampons(t *testing.T) {
	indices := []byte{3, 3, 7, 9}
	poids := make([]byte, 4)
	binary.LittleEndian.PutUint32(poids, 1023|1023<<10|0<<20) // 1, 1, 0 (+1 implicite)
	inf, err := influencesDesTampons(indices, poids, 1, 10)
	if err != nil {
		t.Fatal(err)
	}
	if inf[0].Os[0] != 3 || inf[0].Os[1] != 9 || !presque(float64(inf[0].Poids[0]), 2.0/3) || !presque(float64(inf[0].Poids[1]), 1.0/3) {
		t.Fatalf("influences %+v : attendu os 3 a 2/3, os 9 a 1/3", inf[0])
	}
	inf, err = influencesDesTampons([]byte{1, 1, 2, 2}, nil, 1, 10)
	if err != nil || inf[0].Os[0] != 1 || inf[0].Os[1] != 2 || inf[0].Poids[0] != 0.5 || inf[0].Poids[1] != 0.5 {
		t.Fatalf("rigide a os %+v %v", inf, err)
	}
	if _, err := influencesDesTampons([]byte{10, 0, 0, 0}, nil, 1, 10); err == nil {
		t.Fatal("un indice hors du squelette est refuse")
	}
}

// TestNomDuNoeud : un nom du vocabulaire se retrouve par son hachage, un autre garde son StringID.
func TestNomDuNoeud(t *testing.T) {
	for _, n := range []string{"b_pedestal", "b_r_grip", "b_l_shoulder_helper3", "b_spine1_twist", "b_r_pinky0"} {
		if got := NomDuNoeud(uint32(mapvar.LabelHash(n))); got != n {
			t.Errorf("%s -> %s", n, got)
		}
	}
	if got := NomDuNoeud(0x12345678); got != "noeud_12345678" {
		t.Errorf("hors vocabulaire -> %s", got)
	}
}
