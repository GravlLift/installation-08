package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"
	"testing"
)

// TestEcritGLB verifie le conteneur (en-tete, blocs alignes, longueurs), la conversion
// d'axes (un sommet Halo (1, 2, 3) doit sortir en glTF (1, 3, -2)) et les materiaux : une
// primitive par materiau sur le meme accesseur de positions, un materiau translucide `BLEND`.
func TestEcritGLB(t *testing.T) {
	m := &MaillageMonde{
		Structure: GroupeMaillage{
			Sommets: []float32{1, 2, 3, 4, 5, 6, 7, 8, 9, 7, 8, 9},
			Indices: map[uint32][]uint32{0xA: {0, 1, 2}, 0xB: {1, 2, 3}},
		},
		Materiaux: map[uint32]Materiau{0xA: {ID: 0xA}, 0xB: {ID: 0xB, Melange: MelangeAlpha}},
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", map[string]any{"module": "test"}); err != nil {
		t.Fatalf("ecritGLB : %v", err)
	}
	b := buf.Bytes()
	u32 := func(off int) uint32 { return binary.LittleEndian.Uint32(b[off:]) }
	if u32(0) != glbMagic || u32(4) != glbVersion || int(u32(8)) != len(b) {
		t.Fatalf("en-tete invalide : magic %x version %d longueur %d/%d", u32(0), u32(4), u32(8), len(b))
	}
	lenJSON := int(u32(12))
	if u32(16) != glbChunkJSON || lenJSON%4 != 0 {
		t.Fatalf("bloc JSON invalide : type %x longueur %d", u32(16), lenJSON)
	}
	var doc gltfDoc
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
		t.Fatalf("JSON glTF : %v", err)
	}
	binOff := 20 + lenJSON
	if u32(binOff+4) != glbChunkBIN || int(u32(binOff))%4 != 0 {
		t.Fatalf("bloc BIN invalide")
	}
	if len(doc.Nodes) != 1 || doc.Nodes[0].Name != "structure" {
		t.Fatalf("noeuds : %+v (le groupe decor vide ne doit pas sortir)", doc.Nodes)
	}
	prims := doc.Meshes[0].Primitives
	if len(prims) != 2 || prims[0].Attributes["POSITION"] != prims[1].Attributes["POSITION"] {
		t.Fatalf("primitives : %+v (une par materiau, positions partagees)", prims)
	}
	if a, b := doc.Materials[prims[0].Material], doc.Materials[prims[1].Material]; a.AlphaMode != "OPAQUE" || b.AlphaMode != "BLEND" {
		t.Fatalf("materiaux : %+v / %+v (0xA opaque, 0xB translucide)", a, b)
	}
	pos := doc.Accessors[0]
	if pos.Count != 4 || pos.Min[1] != 3 || pos.Max[2] != -2 {
		t.Fatalf("accesseur de positions : %+v", pos)
	}
	data := b[binOff+8:]
	premier := [3]float32{}
	for k := range premier {
		premier[k] = math.Float32frombits(binary.LittleEndian.Uint32(data[4*k:]))
	}
	if premier != [3]float32{1, 3, -2} {
		t.Fatalf("premier sommet %v, attendu [1 3 -2] (axes glTF)", premier)
	}
}

// TestEcritGLBDecoupe verifie un materiau a decoupe : coordonnees de texture publiees, materiau
// `MASK` au seuil du jeu, image PNG dont l'alpha porte le masque (R d'un masque monocanal) apres
// reglage, transformation des coordonnees en `KHR_texture_transform`.
func TestEcritGLBDecoupe(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	copy(img.Pix, []uint8{255, 255, 255, 255, 0, 0, 0, 255})
	d := &Decoupe{Bitmap: 0xB17, Echelle: [2]float32{2, 3}, Decalage: [2]float32{0.5, 0}, Puissance: 1, Seuil: 0.3}
	m := &MaillageMonde{
		Structure: GroupeMaillage{
			Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0},
			UV:      [NJeuxUV][]float32{{0, 0, 1, 0, 0, 1}},
			Indices: map[uint32][]uint32{0xA: {0, 1, 2}},
		},
		Materiaux: map[uint32]Materiau{0xA: {ID: 0xA, Decoupe: d}},
		Masques:   map[uint32]Texture{0xB17: {Image: img, Monocanal: true}},
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", nil); err != nil {
		t.Fatalf("ecritGLB : %v", err)
	}
	b := buf.Bytes()
	lenJSON := int(binary.LittleEndian.Uint32(b[12:]))
	var doc gltfDoc
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
		t.Fatalf("JSON glTF : %v", err)
	}
	prim := doc.Meshes[0].Primitives[0]
	if uv, ok := prim.Attributes["TEXCOORD_0"]; !ok || doc.Accessors[uv].Count != 3 || doc.Accessors[uv].Type != "VEC2" {
		t.Fatalf("TEXCOORD_0 absent ou faux : %+v", prim.Attributes)
	}
	mat := doc.Materials[prim.Material]
	if mat.AlphaMode != "MASK" || mat.AlphaCutoff == nil || *mat.AlphaCutoff != 0.3 || mat.PBR.BaseColorTexture == nil {
		t.Fatalf("materiau a decoupe : %+v", mat)
	}
	tr, _ := json.Marshal(mat.PBR.BaseColorTexture.Extensions[extTextureTransform])
	if string(tr) != `{"offset":[0.5,0],"scale":[2,3]}` {
		t.Fatalf("transformation %s", tr)
	}
	vue := doc.BufferViews[doc.Images[doc.Textures[mat.PBR.BaseColorTexture.Index].Source].BufferView]
	data := b[20+lenJSON+8:]
	masque, err := png.Decode(bytes.NewReader(data[vue.ByteOffset : vue.ByteOffset+vue.ByteLength]))
	if err != nil {
		t.Fatalf("image du masque : %v", err)
	}
	if _, _, _, a := masque.At(0, 0).RGBA(); a != 0xFFFF {
		t.Fatalf("pixel blanc du masque : alpha %x, attendu plein", a)
	}
	if _, _, _, a := masque.At(1, 0).RGBA(); a != 0 {
		t.Fatalf("pixel noir du masque : alpha %x, attendu nul", a)
	}
}

// TestEcritGLBCouchesDecoupe verifie un materiau a la fois en couches et a decoupe : le
// materiau reste en couches (pas de materiau MASK a part), porte un alpha test au seuil du jeu,
// et l'image de couleur de base a son alpha remplace par le masque du jeu.
func TestEcritGLBCouchesDecoupe(t *testing.T) {
	// Image de couleur 2x1 : pixel rouge, pixel bleu, alpha plein.
	couleur := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	copy(couleur.Pix, []uint8{255, 0, 0, 255, 0, 0, 255, 255})
	// Masque de decoupe 2x1 : pixel plein, pixel vide.
	masque := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	copy(masque.Pix, []uint8{255, 255, 255, 255, 0, 0, 0, 255})
	d := &Decoupe{Bitmap: 0xB17, Echelle: [2]float32{1, 1}, Puissance: 1, Seuil: 0.3}
	c := &Couches{
		JeuUV: jeuUVNiveau,
		Couches: []Couche{{
			Sorte: CoucheCouleur, Bitmap: 0xA1, Teinte: [3]float32{1, 1, 1}, Opacite: 1,
		}},
	}
	m := &MaillageMonde{
		Structure: GroupeMaillage{
			Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0},
			UV:      [NJeuxUV][]float32{{0, 0, 1, 0, 0, 1}, {}, {0, 0, 1, 0, 0, 1}},
			Indices: map[uint32][]uint32{0xA: {0, 1, 2}},
		},
		Materiaux: map[uint32]Materiau{
			0xA: {ID: 0xA, Couches: c, Decoupe: d},
		},
		Masques:         map[uint32]Texture{0xB17: {Image: masque, Monocanal: false}},
		TexturesCouches: map[uint32]Texture{0xA1: {Image: couleur, Monocanal: false}},
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", nil); err != nil {
		t.Fatalf("ecritGLB : %v", err)
	}
	b := buf.Bytes()
	lenJSON := int(binary.LittleEndian.Uint32(b[12:]))
	var doc gltfDoc
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
		t.Fatalf("JSON glTF : %v", err)
	}
	mat := doc.Materials[doc.Meshes[0].Primitives[0].Material]
	// Le materiau est MASK avec son seuil, mais porte aussi ses couches (pas de materiau MASK a part).
	if mat.AlphaMode != "MASK" || mat.AlphaCutoff == nil || *mat.AlphaCutoff != 0.3 {
		t.Fatalf("materiau : alphaMode=%s alphaCutoff=%v (attendu MASK 0.3)", mat.AlphaMode, mat.AlphaCutoff)
	}
	if _, ok := mat.Extras["couches"]; !ok {
		t.Fatal("materiau en couches a decoupe : extras.couches absent")
	}
	if _, ok := mat.Extras["decoupe"]; !ok {
		t.Fatal("materiau en couches a decoupe : extras.decoupe absent")
	}
	// L'image de couleur de base doit porter le masque dans son alpha.
	couches := mat.Extras["couches"].(map[string]any)
	couchesList := couches["couches"].([]any)
	couche0 := couchesList[0].(map[string]any)
	texIdx := int(couche0["texture"].(float64))
	imgIdx := doc.Textures[texIdx].Source
	bv := doc.BufferViews[doc.Images[imgIdx].BufferView]
	data := b[20+lenJSON+8:]
	img, err := png.Decode(bytes.NewReader(data[bv.ByteOffset : bv.ByteOffset+bv.ByteLength]))
	if err != nil {
		t.Fatalf("image de couleur : %v", err)
	}
	// Pixel 0 (masque plein) : alpha doit etre plein.
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0xFFFF {
		t.Fatalf("pixel 0 : alpha %x, attendu plein (masque 255)", a)
	}
	// Pixel 1 (masque vide) : alpha doit etre nul.
	if _, _, _, a := img.At(1, 0).RGBA(); a != 0 {
		t.Fatalf("pixel 1 : alpha %x, attendu nul (masque 0)", a)
	}
}

// TestDecoupeDuShader lit le bloc AlphaInfo d'un shader de la table et ignore un shader inconnu.
func TestDecoupeDuShader(t *testing.T) {
	c := make([]byte, 320)
	for i, v := range []float32{0.5, 0.5, 0.25, 0, 2, 0.1, 0.3} {
		binary.LittleEndian.PutUint32(c[208+4*i:], math.Float32bits(v))
	}
	tex := map[int]uint32{192: 0xB17}
	d := decoupeDuShader(0x4a13c07c, tex, c)
	if d == nil || d.Bitmap != 0xB17 || d.Echelle != [2]float32{0.5, 0.5} || d.Decalage[0] != 0.25 ||
		d.Puissance != 2 || float32(d.Ajout) != float32(0.1) || d.Seuil != float32(0.3) {
		t.Fatalf("decoupe lue %+v", d)
	}
	if decoupeDuShader(0x12345678, tex, c) != nil {
		t.Fatal("un shader hors table n'a pas de decoupe")
	}
	if decoupeDuShader(0x4a13c07c, map[int]uint32{}, c) != nil {
		t.Fatal("sans texture a l'emplacement, pas de decoupe")
	}
}

// TestEcritGLBCouchesDecoupeImagesVerifiees verifie que toutes les images d'un GLB portant des
// materiaux en couches a decoupe et un materiau en couches ordinaire portent une signature
// PNG ou JPEG valide et se decodent. C'est la regression que le reecrit sur place du tampon
// binaire causait : les vues qui suivaient une image reecrite pointaient vers les mauvais octets.
func TestEcritGLBCouchesDecoupeImagesVerifiees(t *testing.T) {
	// Une image de couleur 32x32 avec des variations : le JPEG d'origine et le PNG de la copie
	// avec masque ont des tailles differentes, si bien que le reecrit sur place (le defect) fait
	// defiler les vues qui suivent.
	img32 := func(seed byte) *image.NRGBA {
		img := image.NewNRGBA(image.Rect(0, 0, 32, 32))
		for y := 0; y < 32; y++ {
			for x := 0; x < 32; x++ {
				r := seed + byte((x*7+y*3)%256)
				g := seed + byte((x*11+y*5)%256)
				b := seed + byte((x*13+y*7)%256)
				img.Set(x, y, color.NRGBA{R: r, G: g, B: b, A: 255})
			}
		}
		return img
	}
	// Un masque de decoupe 32x32 (moitie pleine, moitie vide).
	masqueImg := func() *image.NRGBA {
		img := image.NewNRGBA(image.Rect(0, 0, 32, 32))
		for y := 0; y < 32; y++ {
			for x := 0; x < 32; x++ {
				a := byte(0)
				if x < 16 {
					a = 255
				}
				img.Set(x, y, color.NRGBA{R: 255, G: 255, B: 255, A: a})
			}
		}
		return img
	}
	decoupe := &Decoupe{Bitmap: 0xB17, Puissance: 1, Seuil: 0.3}
	matDecoupe1 := &Couches{
		JeuUV: jeuUVNiveau,
		Couches: []Couche{
			{Sorte: CoucheCouleur, Bitmap: 0xA1, Teinte: [3]float32{1, 1, 1}, Opacite: 1},
			{Sorte: CoucheCouleur, Bitmap: 0xA2, Teinte: [3]float32{1, 1, 1}, Opacite: 1},
		},
	}
	matDecoupe2 := &Couches{
		JeuUV: jeuUVNiveau,
		Couches: []Couche{
			{Sorte: CoucheCouleur, Bitmap: 0xB1, Teinte: [3]float32{1, 1, 1}, Opacite: 1},
		},
	}
	matOrdinaire := &Couches{
		JeuUV: jeuUVNiveau,
		Couches: []Couche{
			{Sorte: CoucheCouleur, Bitmap: 0xC1, Teinte: [3]float32{1, 1, 1}, Opacite: 1},
			{Sorte: CoucheCouleur, Bitmap: 0xC2, Teinte: [3]float32{1, 1, 1}, Opacite: 1},
			{Sorte: CoucheCouleur, Bitmap: 0xC3, Teinte: [3]float32{1, 1, 1}, Opacite: 1},
		},
	}
	m := &MaillageMonde{
		Structure: GroupeMaillage{
			Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 3, 0, 0, 4, 0, 0, 5, 0, 0, 6, 0, 0},
			UV:      [NJeuxUV][]float32{{0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1}, {}, {0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1}},
			Indices: map[uint32][]uint32{
				0xA: {0, 1, 2},
				0xB: {1, 2, 3},
				0xC: {3, 4, 5},
			},
		},
		Materiaux: map[uint32]Materiau{
			0xA: {ID: 0xA, Couches: matDecoupe1, Decoupe: decoupe},
			0xB: {ID: 0xB, Couches: matDecoupe2, Decoupe: decoupe},
			0xC: {ID: 0xC, Couches: matOrdinaire},
		},
		Masques: map[uint32]Texture{0xB17: {Image: masqueImg(), Monocanal: false}},
		TexturesCouches: map[uint32]Texture{
			0xA1: {Image: img32(100), Monocanal: false},
			0xA2: {Image: img32(150), Monocanal: false},
			0xB1: {Image: img32(50), Monocanal: false},
			0xC1: {Image: img32(20), Monocanal: false},
			0xC2: {Image: img32(70), Monocanal: false},
			0xC3: {Image: img32(120), Monocanal: false},
		},
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", nil); err != nil {
		t.Fatalf("ecritGLB : %v", err)
	}
	b := buf.Bytes()
	lenJSON := int(binary.LittleEndian.Uint32(b[12:]))
	var doc gltfDoc
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
		t.Fatalf("JSON glTF : %v", err)
	}
	data := b[20+lenJSON+8:]
	// Verifie que le chemin de decoupe est bien exerce : le materiau 0xA porte un alpha test
	// et sa couleur de base pointe vers une image PNG (la copie avec masque).
	matA := doc.Materials[doc.Meshes[0].Primitives[0].Material]
	if matA.AlphaMode != "MASK" || matA.AlphaCutoff == nil {
		t.Fatalf("materiau 0xA : attendu MASK avec alphaCutoff, obtenu %s %v", matA.AlphaMode, matA.AlphaCutoff)
	}
	if matA.PBR.BaseColorTexture == nil {
		t.Fatal("materiau 0xA : couleur de base absente")
	}
	imgIdx := doc.Textures[matA.PBR.BaseColorTexture.Index].Source
	bv := doc.BufferViews[doc.Images[imgIdx].BufferView]
	raw := data[bv.ByteOffset : bv.ByteOffset+bv.ByteLength]
	if len(raw) < 4 || raw[0] != 0x89 || raw[1] != 0x50 || raw[2] != 0x4e || raw[3] != 0x47 {
		t.Fatalf("couleur de base du materiau 0xA : attendu une image PNG (copie avec masque), obtenu %x", raw[:4])
	}
	// Toutes les images du fichier portent une signature PNG ou JPEG valide et se decodent.
	var fails []string
	for i := range doc.Images {
		bv := doc.BufferViews[doc.Images[i].BufferView]
		raw := data[bv.ByteOffset : bv.ByteOffset+bv.ByteLength]
		if len(raw) < 2 {
			fails = append(fails, fmt.Sprintf("image %d : trop courte", i))
			continue
		}
		var decodable bool
		switch {
		case raw[0] == 0x89 && raw[1] == 0x50 && raw[2] == 0x4e && raw[3] == 0x47:
			_, err := png.Decode(bytes.NewReader(raw))
			decodable = err == nil
		case raw[0] == 0xff && raw[1] == 0xd8:
			_, err := jpeg.Decode(bytes.NewReader(raw))
			decodable = err == nil
		default:
			decodable = false
		}
		if !decodable {
			fails = append(fails, fmt.Sprintf("image %d : signature %x", i, raw[:4]))
		}
	}
	if len(fails) > 0 {
		t.Fatalf("%d image(s) invalide(s) sur %d : %v", len(fails), len(doc.Images), fails)
	}
}
