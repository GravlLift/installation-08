package himap

import (
	"encoding/binary"
	"image"
	"math"
	"testing"
)

func TestTerrainJointLesTuilesEtDecodeLesHauteurs(t *testing.T) {
	tuiles := []tuileTerrain{{X: 0, Y: 0, Hauteurs: make([]byte, 18)}, {X: 1, Y: 0, Hauteurs: make([]byte, 18)}}
	for k := range tuiles {
		for i := 0; i < 9; i++ {
			binary.LittleEndian.PutUint16(tuiles[k].Hauteurs[i*2:], 32768)
		}
	}
	g, err := assembleTerrain(tuiles, parametresTerrain{Resolution: 2, Pas: [2]float64{1, 1}, Origine: [3]float64{0, 0, -2}, Amplitude: 4, Materiau: 123})
	if err != nil {
		t.Fatal(err)
	}
	if len(g.Sommets)/3 != 15 || g.Triangles() != 16 {
		t.Fatalf("sommets=%d triangles=%d", len(g.Sommets)/3, g.Triangles())
	}
	for i := 0; i < len(g.Sommets); i += 3 {
		if math.Abs(float64(g.Sommets[i+2])) > 0.001 {
			t.Fatalf("hauteur %g", g.Sommets[i+2])
		}
	}
	if len(g.Normales) != len(g.Sommets) {
		t.Fatalf("normales=%d", len(g.Normales))
	}
	for i := 2; i < len(g.Normales); i += 3 {
		if g.Normales[i] < .99 {
			t.Fatalf("normale z=%g", g.Normales[i])
		}
	}
}
func TestTerrainRetourneLesLignes(t *testing.T) {
	data := make([]byte, 8)
	binary.LittleEndian.PutUint16(data[0:2], 65535)
	g, err := assembleTerrain([]tuileTerrain{{Hauteurs: data}}, parametresTerrain{Resolution: 1, Pas: [2]float64{1, 1}, Amplitude: 2, Materiau: 1})
	if err != nil {
		t.Fatal(err)
	}
	if g.Sommets[2] != 0 || g.Sommets[8] != 2 {
		t.Fatalf("hauteurs inversees : %v", g.Sommets)
	}
}

func TestTerrainSelectionneLeNiveauDansLeBudget(t *testing.T) {
	s := sourceTerrain{resolution: 128, niveaux: 7, taille: [3]float64{819.2, 819.2, 49.8}, position: [3]float64{153.6, 204.8, -15}}
	p, err := choisitPlageTerrain(s, [4]float64{-29.3341, -5.31375, 48.97163, 68.066})
	if err != nil {
		t.Fatal(err)
	}
	if p.niveau != 5 || (p.x1-p.x0+1)*(p.y1-p.y0+1) != 16 {
		t.Fatalf("plage : %+v", p)
	}
}

func TestTerrainGLBPublieLesNormales(t *testing.T) {
	doc := &gltfDoc{}
	bin := &tamponGLB{}
	attrs := map[string]int{}
	ajouteNormalesGLB(doc, bin, &GroupeMaillage{Sommets: []float32{1, 2, 3}, Normales: []float32{0, 0, 1}}, attrs)
	if _, ok := attrs["NORMAL"]; !ok || bin.Len() != 12 {
		t.Fatalf("attributs=%v taille=%d", attrs, bin.Len())
	}
}

func TestTerrainGLBPublieLaTexture(t *testing.T) {
	tex := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	tex.Pix = []byte{100, 80, 40, 255}
	g := GroupeMaillage{Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, Normales: []float32{0, 0, 1, 0, 0, 1, 0, 0, 1}, UV: [NJeuxUV][]float32{{0, 0, 1, 0, 0, 1}}, Indices: map[uint32][]uint32{12: {0, 1, 2}}}
	mat := Materiau{ID: 12, Couches: &Couches{Couches: []Couche{{Bitmap: 12, Transfo: transfoNeutre, Teinte: [3]float32{1, 1, 1}, Opacite: 1}}}}
	m := &MaillageMonde{Terrain: g, Materiaux: map[uint32]Materiau{12: mat}, TexturesCouches: map[uint32]Texture{12: {Image: tex}}}
	doc, _, err := documentGLB(m, "test", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Meshes) != 1 || doc.Meshes[0].Name != "structureTerrain" {
		t.Fatalf("maillages: %+v", doc.Meshes)
	}
	p := doc.Meshes[0].Primitives[0]
	if _, ok := p.Attributes["NORMAL"]; !ok {
		t.Fatal("normales absentes")
	}
	if doc.Materials[p.Material].PBR.BaseColorTexture == nil {
		t.Fatal("texture couleur absente")
	}
}
