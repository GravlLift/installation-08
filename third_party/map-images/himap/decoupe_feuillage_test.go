package himap

// decoupe_feuillage_test.go — LOCAL-CHANGE (infinite-theater-3d): foliage cuts (leaf atlas alpha,
// alpha-only cuts that never cross the threshold, foliage cards without UV1).

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"image"
	"testing"
)

// TestDecoupeAtlasFeuillage : a shader that binds the leaf atlas (by name, or by its own slot) is
// cut by the atlas's alpha alone; one that binds none has no cut.
func TestDecoupeAtlasFeuillage(t *testing.T) {
	params := ParametresShader{nomAtlasFeuillage: 12, 0x0d66c9ce: 8}
	tex := map[int]uint32{12: 0xA7, 8: 0xB0}
	d := decoupeAtlasFeuillage(0x4fd62060, params, tex)
	if d == nil || d.Bitmap != 0xA7 || !d.AlphaSeul || d.Seuil != seuilDecoupeDefaut || d.Echelle != [2]float32{1, 1} || d.Puissance != 1 {
		t.Fatalf("atlas cut %+v", d)
	}
	if d := decoupeAtlasFeuillage(0x669c3e5e, ParametresShader{0xdaef076c: 4}, map[int]uint32{4: 0xC4}); d == nil || d.Bitmap != 0xC4 {
		t.Fatalf("669c3e5e atlas cut %+v", d)
	}
	if decoupeAtlasFeuillage(0x12345678, ParametresShader{0x0d66c9ce: 8}, tex) != nil {
		t.Fatal("a shader without a leaf atlas has no cut")
	}
	if decoupeAtlasFeuillage(0x4fd62060, params, map[int]uint32{8: 0xB0}) != nil {
		t.Fatal("without a texture in the atlas slot, no cut")
	}
}

func alphas(as ...uint8) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, len(as), 1))
	for i, a := range as {
		img.Pix[4*i+3] = a
	}
	return img
}

// TestAlphaTranche : only an alpha with pixels on both sides of the threshold cuts.
func TestAlphaTranche(t *testing.T) {
	for _, c := range []struct {
		img  *image.NRGBA
		want bool
	}{
		{alphas(0, 255), true},
		{alphas(127, 128), true},
		{alphas(255, 255), false},
		{alphas(0, 0), false},
		{alphas(0, 1, 4), false}, // Fortress's Forge walls: an unused ASG alpha
		{alphas(128, 200), false},
	} {
		if got := alphaTranche(c.img, 0.5); got != c.want {
			t.Errorf("alphaTranche(%v) = %v, want %v", c.img.Pix, got, c.want)
		}
	}
}

// TestEcritGLBDecoupeAtlas : a layered material cut by its leaf atlas's alpha is MASK, its first
// layer's color carries the leaves' alpha; with an alpha that never crosses the threshold it stays
// opaque.
func TestEcritGLBDecoupeAtlas(t *testing.T) {
	atlas := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	copy(atlas.Pix, []uint8{40, 120, 30, 255, 30, 60, 20, 0})
	inutilise := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	copy(inutilise.Pix, []uint8{40, 120, 30, 1, 30, 60, 20, 4})
	couches := func(b uint32) *Couches {
		return &Couches{JeuUV: jeuUVDiffus, Couches: []Couche{{Sorte: CoucheCouleur, Bitmap: b, Teinte: [3]float32{1, 1, 1}, Opacite: 1}}}
	}
	decoupe := func(b uint32) *Decoupe {
		return &Decoupe{Bitmap: b, Echelle: [2]float32{1, 1}, Puissance: 1, Seuil: 0.5, AlphaSeul: true}
	}
	m := &MaillageMonde{
		Structure: GroupeMaillage{
			Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1},
			UV:      [NJeuxUV][]float32{{0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1}},
			Indices: map[uint32][]uint32{0xA: {0, 1, 2}, 0xB: {3, 4, 5}},
		},
		Materiaux: map[uint32]Materiau{
			0xA: {ID: 0xA, Couches: couches(0xA1), Decoupe: decoupe(0xA1)},
			0xB: {ID: 0xB, Couches: couches(0xB1), Decoupe: decoupe(0xB1)},
		},
		Masques:         map[uint32]Texture{0xA1: {Image: atlas}, 0xB1: {Image: inutilise}},
		TexturesCouches: map[uint32]Texture{0xA1: {Image: atlas}, 0xB1: {Image: inutilise}},
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	n := int(binary.LittleEndian.Uint32(b[12:]))
	var doc gltfDoc
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+n], " "), &doc); err != nil {
		t.Fatal(err)
	}
	modes := map[string]string{}
	for _, g := range doc.Materials {
		modes[g.Name] = g.AlphaMode
	}
	if modes["mat_0000000a"] != "MASK" {
		t.Errorf("leaf atlas material: %s, want MASK", modes["mat_0000000a"])
	}
	if modes["mat_0000000b"] != "OPAQUE" {
		t.Errorf("unused alpha material: %s, want OPAQUE", modes["mat_0000000b"])
	}
}

// TestAvecJeuMacro : a mesh without UV1 reads its UV0 there; one with its own UV1 keeps it, and
// the source mesh is not changed.
func TestAvecJeuMacro(t *testing.T) {
	uv0 := [][2]float32{{0.1, 0.2}, {0.3, 0.4}}
	m := &Mesh{UV: [NJeuxUV][][2]float32{uv0, nil, nil}}
	c := avecJeuMacro(m)
	if len(c.UV[jeuUVMacro]) != 2 || c.UV[jeuUVMacro][1] != uv0[1] {
		t.Fatalf("UV1 %v, want UV0", c.UV[jeuUVMacro])
	}
	if m.UV[jeuUVMacro] != nil {
		t.Fatal("the source mesh was changed")
	}
	propre := &Mesh{UV: [NJeuxUV][][2]float32{uv0, {{0.9, 0.9}, {0.8, 0.8}}, nil}}
	if avecJeuMacro(propre) != propre {
		t.Fatal("a mesh with its own UV1 keeps it")
	}
}
