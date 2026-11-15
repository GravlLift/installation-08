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

// TestTeintesForgeScindeMateriaux (LOCAL-CHANGE (infinite-theater-3d): placements): two tints of
// a flat material give two materials of their own; a material whose layers carry a read texture
// keeps its layers; an untinted placement and an `ombre` geometry keep their source material.
func TestTeintesForgeScindeMateriaux(t *testing.T) {
	a := TeinteForge{Couleur: [3]float32{.25, .5, .75}, Rugosite: .6, Metal: .2}
	b := TeinteForge{Couleur: [3]float32{.5, .5, .5}, Rugosite: 1}
	geo := GroupeMaillage{Indices: map[uint32][]uint32{1: {0, 1, 2}, 2: {0, 1, 2}}}
	pv := &PosesVariante{Geometries: []GeometrieVariante{{Maillage: geo}, {Maillage: geo, Ombre: true}}}
	mats := []uint32{4, 5}
	pv.Poses = []PoseVariante{
		{Geometrie: 0, Materiaux: mats, Teinte: &a},
		{Geometrie: 0, Materiaux: mats, Teinte: &b},
		{Geometrie: 0, Materiaux: mats},
		{Geometrie: 1, Materiaux: mats, Teinte: &a},
	}
	m := MaillageMonde{Poses: pv, Materiaux: map[uint32]Materiau{4: {Shader: 17}, 5: {Couches: &Couches{Couches: []Couche{{Bitmap: 12}}}}}, TexturesCouches: map[uint32]Texture{12: {}}}
	m.appliqueTeintes()
	if len(m.teintesForge) != 2 {
		t.Fatalf("materiaux teintes : %+v", m.teintesForge)
	}
	ta, tb := pv.materiauDe(pv.Poses[0], 1), pv.materiauDe(pv.Poses[1], 1)
	if ta == 4 || tb == 4 || ta == tb {
		t.Errorf("teintes du materiau plat : %d %d", ta, tb)
	}
	if pv.materiauDe(pv.Poses[0], 2) != 5 || pv.materiauDe(pv.Poses[2], 1) != 4 || pv.materiauDe(pv.Poses[3], 1) != 4 {
		t.Error("couches, placement sans teinte ou ombre teintes")
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
