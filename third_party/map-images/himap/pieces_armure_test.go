package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"math"
	"testing"
)

// TestLisInstanceMarqueur : un enregistrement d'instance du Spartan (groupe 664a74e8, instance 0),
// octets tels que lus dans le tag.
func TestLisInstanceMarqueur(t *testing.T) {
	rec, err := hex.DecodeString("ffbcbcbcffffffff290001bccd867c3bc808f63b0bb0333a5c244cb993d894bc97b0a1bc69e87f3fcdcccc3d333e3bbce75c6d3ea202793f")
	if err != nil {
		t.Fatal(err)
	}
	in := lisInstanceMarqueur(rec)
	if in.Region != -1 || in.Permutation != -1 || in.Noeud != 0x29 {
		t.Fatalf("instance %+v : attendu region -1, permutation -1, noeud 41", in)
	}
	if !presque(in.Translation[0], 0.003853) || !presque(in.Rotation[3], 0.99964) {
		t.Fatalf("translation %v rotation %v", in.Translation, in.Rotation)
	}
	n := 0.0
	for _, c := range in.Rotation {
		n += c * c
	}
	if math.Abs(n-1) > 1e-3 {
		t.Fatalf("quaternion de norme %f", n)
	}
}

// TestLisMarqueurAccessoire : le marqueur de l'epauliere gauche du Mark VII (ocad b377ea7e).
func TestLisMarqueurAccessoire(t *testing.T) {
	rec, err := hex.DecodeString("1abada480000000000000000000000000000000000000000000000000000803f0000803f0000803f")
	if err != nil {
		t.Fatal(err)
	}
	m := lisMarqueurAccessoire(rec)
	if m.Nom != 0x48daba1a || m.Translation != [3]float64{} || m.Rotation != [4]float64{0, 0, 0, 1} {
		t.Fatalf("marqueur %+v : attendu 48daba1a, identite", m)
	}
}

// modeleTexture : le modele a peau de TestEcritGLBPeau, peint d'une surface dure a deux images.
func modeleTexture() *ModeleAPeau {
	m := &ModeleAPeau{
		Maillage: &MaillageMonde{
			Structure: GroupeMaillage{
				Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 0, 1},
				UV:      [NJeuxUV][]float32{{0, 0, 1, 0, 0, 1}},
				Indices: map[uint32][]uint32{0xA: {0, 1, 2}},
			},
			Materiaux:       map[uint32]Materiau{0xA: {ID: 0xA, Surface: &SurfaceDure{MasqueA: 1, ASG: 2, Normale: 3}}},
			TexturesCouches: map[uint32]Texture{1: *uni(4, 4, 255, 0, 0), 2: *uni(4, 4, 255, 0, 0), 3: *uni(4, 4, 128, 128, 0)},
		},
		Noeuds: squeletteDeDeux(),
		Noms:   []string{"b_pedestal", "b_pelvis"},
		Influences: []Influences{
			{Poids: [OsParSommet]float32{1}}, {Poids: [OsParSommet]float32{1}}, {Os: [OsParSommet]uint16{1}, Poids: [OsParSommet]float32{1}},
		},
	}
	return m
}

// TestExterniseImagesGLB : les images sortent par le depot, le bloc binaire ne garde que la
// geometrie, les accesseurs pointent les memes octets qu'avant.
func TestExterniseImagesGLB(t *testing.T) {
	var buf bytes.Buffer
	if err := EcritGLBPeau(&buf, modeleTexture(), "test", nil); err != nil {
		t.Fatal(err)
	}
	avant := buf.Bytes()
	deposees := map[string][]byte{}
	apres, n, err := ExterniseImagesGLB(avant, func(d []byte, mime string) (string, error) {
		uri := "image-" + mime + "-" + string(rune('a'+len(deposees)))
		deposees[uri] = append([]byte(nil), d...)
		return uri, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 3 || len(deposees) != 3 || len(apres) >= len(avant) {
		t.Fatalf("%d images deposees (%d), %d -> %d octets", n, len(deposees), len(avant), len(apres))
	}
	docA, binA := lisDocTest(t, avant)
	docB, binB := lisDocTest(t, apres)
	if len(docB.Images) != 3 || len(docB.BufferViews) != len(docA.BufferViews)-3 {
		t.Fatalf("images %d, vues %d -> %d", len(docB.Images), len(docA.BufferViews), len(docB.BufferViews))
	}
	for i, a := range docA.Accessors {
		va, vb := docA.BufferViews[a.BufferView], docB.BufferViews[docB.Accessors[i].BufferView]
		if !bytes.Equal(binA[va.ByteOffset:va.ByteOffset+va.ByteLength], binB[vb.ByteOffset:vb.ByteOffset+vb.ByteLength]) {
			t.Fatalf("accesseur %d : octets differents apres compactage", i)
		}
	}
	var brut struct {
		Images []map[string]any `json:"images"`
	}
	lj := int(binary.LittleEndian.Uint32(apres[12:]))
	if err := json.Unmarshal(bytes.TrimRight(apres[20:20+lj], " "), &brut); err != nil {
		t.Fatal(err)
	}
	for _, im := range brut.Images {
		if _, ok := deposees[im["uri"].(string)]; !ok || im["bufferView"] != nil {
			t.Fatalf("image %v : attendu une URI du depot, sans vue de tampon", im)
		}
	}
	if pareil, k, err := ExterniseImagesGLB(apres, nil); err != nil || k != 0 || !bytes.Equal(pareil, apres) {
		t.Fatalf("sans image a deposer, le GLB passe tel quel (%d, %v)", k, err)
	}
}

// lisDocTest rend le document typé et le bloc binaire d'un GLB.
func lisDocTest(t *testing.T, glb []byte) (gltfDoc, []byte) {
	t.Helper()
	lj := int(binary.LittleEndian.Uint32(glb[12:]))
	var doc gltfDoc
	if err := json.Unmarshal(bytes.TrimRight(glb[20:20+lj], " "), &doc); err != nil {
		t.Fatal(err)
	}
	return doc, glb[20+lj+8:]
}

// TestExterniseImagesGLBRefuse : des octets qui ne sont pas un GLB sont refuses.
func TestExterniseImagesGLBRefuse(t *testing.T) {
	if _, _, err := ExterniseImagesGLB([]byte("pas un glb du tout"), nil); err == nil {
		t.Fatal("attendu ErrGLBIllisible")
	}
}

// TestCleArmure : la cle de piece est `region-permutation` en hexadecimal sur 8 chiffres.
func TestCleArmure(t *testing.T) {
	if got := (CleArmure{Region: 0xe5f7f02b, Permutation: 0x0d}).String(); got != "e5f7f02b-0000000d" {
		t.Fatalf("cle %s", got)
	}
}
