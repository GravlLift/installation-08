package himap

import (
	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"testing"
)

func TestTeintesForge(t *testing.T) {
	data := []byte(`{"layers":{"a":{"name":7,"layer":{"mid_color":[0.5,0.25,1],"roughness":4,"metallic":-1}}}}`)
	tint := &mapvar.Vec3{X: .5, Y: 1, Z: .5}
	styles := map[int32][]mapvar.StyleLayer{1: {{Hash: 7, Tint: tint, Scalar: 1}}, 2: {{Hash: 7, Tint: tint}}, 3: {{Hash: 7, Scalar: 1}}, 4: {{Hash: 9}}, 5: {}}
	got, err := LitMateriauxForge(data, styles)
	if err != nil {
		t.Fatal(err)
	}
	if got[1].Couleur != [3]float32{.25, .25, .5} || got[2].Couleur != [3]float32{.5, .25, 1} || got[3] != got[2] || len(got) != 3 || got[1].Rugosite != 1 || got[1].Metal != 0 {
		t.Fatalf("teintes: %+v", got)
	}
}
func TestTeintesForgeScindeMateriaux(t *testing.T) {
	a := TeinteForge{Couleur: [3]float32{.25, .5, .75}, Rugosite: .6, Metal: .2}
	b := TeinteForge{Couleur: [3]float32{.5, .5, .5}, Rugosite: 1}
	m := MaillageMonde{Structure: GroupeMaillage{Indices: map[uint32][]uint32{4: {0, 1, 2, 3, 4, 5, 6, 7, 8}, 5: {0, 1, 2}}}, Materiaux: map[uint32]Materiau{4: {Shader: 17}, 5: {Couches: &Couches{Couches: []Couche{{Bitmap: 12}}}}}, TexturesCouches: map[uint32]Texture{12: {}}, plagesForge: []plageForge{{4, 0, 3, a}, {4, 3, 6, b}, {5, 0, 3, a}}}
	m.appliqueTeintes()
	if len(m.teintesForge) != 2 || len(m.Structure.Indices[4]) != 3 || len(m.Structure.Indices[5]) != 3 {
		t.Fatalf("indices: %+v", m.Structure.Indices)
	}
	doc := &gltfDoc{}
	e := ecrivainMateriaux{doc: doc, m: &m, rangs: map[uint32]int{}}
	for id, mt := range m.teintesForge {
		g := e.rang(id)
		mat := doc.Materials[g]
		if mat.Extras["shader"] != uint32(17) || mat.Extras["teinte"] != mt.teinte.Couleur || mat.PBR.BaseColorFactor[3] != 1 || mat.PBR.RoughnessFactor != mt.teinte.Rugosite || mat.PBR.MetallicFactor != mt.teinte.Metal {
			t.Fatalf("matériau: %+v", mat)
		}
	}
}
