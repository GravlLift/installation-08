package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/png"
	"math"
	"testing"
)

// TestCouchesParNoms lit un shader fabrique par les noms de ses parametres : premiere couche
// `rohm` (sans opacite ni melange), deuxieme `rohg` (degrade, opacite), troisieme `nnhg`
// declaree mais sans texture liee (omise), quatrieme `nnhg` ; transformations par registre.
func TestCouchesParNoms(t *testing.T) {
	c := make([]byte, 1024)
	pose := func(o int, v ...float32) {
		for i, f := range v {
			binary.LittleEndian.PutUint32(c[o+4*i:], math.Float32bits(f))
		}
	}
	n1, n2, n3, n4 := nomsCouches[0], nomsCouches[1], nomsCouches[2], nomsCouches[3]
	params := ParametresShader{nomMasqueMacro: 0,
		n1.couleur: 100, n1.normale: 104, n1.controle: 108, n1.teinte: 112, n1.intensiteNormale: 124,
		n2.controle: 200, n2.normale: 204, n2.haut: 208, n2.milieu: 220, n2.bas: 232,
		n2.opacite: 244, n2.intensiteNormale: 248, n2.melange: 252, n2.melangeNormale: 256,
		n3.paquet: 300, n4.paquet: 400, n4.haut: 404}
	pose(112, 0.5, 0.25, 1)
	pose(124, 0.75)
	pose(10*tailleRegistre, 4, 2, 0.5, 0)
	pose(11*tailleRegistre, 8, 8, 0, 0)
	pose(208, 1, 0, 0)
	pose(220, 0, 1, 0)
	pose(232, 0, 0, 1)
	pose(244, 0.4)
	pose(248, 99) // bornee
	binary.LittleEndian.PutUint32(c[252:], 1)
	binary.LittleEndian.PutUint32(c[256:], 7)
	pose(404, 0.2, 0.2, 0.2)
	pp := postprocessLu{
		textures:   map[int]uint32{0: 0xA, 100: 0xC1, 104: 0xD1, 108: 0xE1, 200: 0xC2, 204: 0xD2, 400: 0xF1},
		transfos:   map[int]int{0: -1, 100: 10, 104: 11, 108: -1, 200: 12, 204: -1, 400: -1},
		constantes: c,
	}
	got := couchesParNoms(params, pp)
	if got == nil || got.Masque != 0xA || got.JeuUV != jeuUVNiveau || len(got.Couches) != 3 {
		t.Fatalf("couches %+v", got)
	}
	k1, k2, k4 := got.Couches[0], got.Couches[1], got.Couches[2]
	if k1.Sorte != CoucheCouleur || k1.Bitmap != 0xC1 || k1.Teinte != [3]float32{0.5, 0.25, 1} ||
		k1.Transfo != (Transfo{[2]float32{4, 2}, [2]float32{0.5, 0}}) || k1.Opacite != 1 {
		t.Fatalf("couche 1 %+v", k1)
	}
	if k1.Normale != 0xD1 || k1.Controle != 0xE1 || k1.TransfoNormale.Echelle != [2]float32{8, 8} ||
		k1.IntensiteNormale != 0.75 || k1.TransfoControle != transfoNeutre {
		t.Fatalf("relief couche 1 %+v", k1)
	}
	// rohg : la carte de controle est celle du degrade ; registre a echelle nulle : 1.
	if k2.Sorte != CoucheDegrade || k2.Haut != [3]float32{1, 0, 0} || k2.Milieu != [3]float32{0, 1, 0} ||
		k2.Bas != [3]float32{0, 0, 1} || k2.Melange != 1 || float32(k2.Opacite) != float32(0.4) || k2.Transfo != transfoNeutre {
		t.Fatalf("couche 2 %+v", k2)
	}
	if k2.Normale != 0xD2 || k2.Controle != 0xC2 || k2.MelangeNormale != 1 || k2.IntensiteNormale != intensiteNormaleMax {
		t.Fatalf("relief couche 2 %+v", k2)
	}
	// nnhg : la carte packee porte la normale et le degrade, pas d'occlusion.
	if k4.Sorte != CoucheDegrade || k4.Bitmap != 0xF1 || k4.Normale != 0xF1 || k4.Controle != 0 ||
		k4.Haut != [3]float32{0.2, 0.2, 0.2} || k4.TransfoNormale != k4.Transfo {
		t.Fatalf("couche packee %+v", k4)
	}
	if couchesParNoms(ParametresShader{0x12345678: 0}, pp) != nil {
		t.Fatal("un shader sans nom de couche n'a pas de couches")
	}
}

// TestSurfaceParNoms : un shader hors gabarit de niveau se lit par sa surface unique, sur le 1er
// jeu : degrade `base_*` (couleurs aux octets du shader, intensite de la normale), carte de
// couleur `surface_*` teintee.
func TestSurfaceParNoms(t *testing.T) {
	c := make([]byte, 128)
	pose := func(o int, v ...float32) {
		for i, f := range v {
			binary.LittleEndian.PutUint32(c[o+4*i:], math.Float32bits(f))
		}
	}
	pose(0, 0.3, 0.2, 0.1)
	pose(16, 0.1, 0.1, 0.1)
	pose(32, 0.05, 0.05, 0.05)
	pose(80, 0.75)
	pose(96, 0.6, 0.5, 0.4)
	base := nomsSurfaces[0]
	params := ParametresShader{base.controle: 84, base.normale: 44, base.haut: 0, base.milieu: 16, base.bas: 32, base.intensiteNormale: 80}
	pp := postprocessLu{textures: map[int]uint32{44: 0xD1, 84: 0xC1}, transfos: map[int]int{44: -1, 84: -1}, constantes: c}
	got := couchesParNoms(params, pp)
	if got == nil || got.JeuUV != jeuUVDiffus || got.Masque != 0 || len(got.Couches) != 1 {
		t.Fatalf("degrade %+v", got)
	}
	if k := got.Couches[0]; k.Sorte != CoucheDegrade || k.Bitmap != 0xC1 || k.Controle != 0xC1 || k.Normale != 0xD1 ||
		k.Haut != [3]float32{0.3, 0.2, 0.1} || k.Bas != [3]float32{0.05, 0.05, 0.05} || k.IntensiteNormale != 0.75 {
		t.Fatalf("degrade %+v", k)
	}
	surf := nomsSurfaces[1]
	params = ParametresShader{surf.couleur: 0, surf.teinte: 96, surf.normale: 116}
	pp = postprocessLu{textures: map[int]uint32{0: 0xA1, 116: 0xD2}, transfos: map[int]int{0: -1, 116: -1}, constantes: c}
	got = couchesParNoms(params, pp)
	if got == nil || got.JeuUV != jeuUVDiffus || len(got.Couches) != 1 {
		t.Fatalf("surface %+v", got)
	}
	if k := got.Couches[0]; k.Sorte != CoucheCouleur || k.Bitmap != 0xA1 || k.Normale != 0xD2 ||
		k.Teinte != [3]float32{0.6, 0.5, 0.4} {
		t.Fatalf("surface %+v", k)
	}
}

// TestSurfaceFeuillage lit l'atlas et la normale par leurs noms et conserve la priorite des surfaces connues.
func TestSurfaceFeuillage(t *testing.T) {
	params := ParametresShader{0xca775400: 36, 0x0d66c9ce: 8, 0x9d92f94d: 1}
	pp := postprocessLu{textures: map[int]uint32{36: 0xA, 8: 0xB}}
	got := couchesParNoms(params, pp)
	if got == nil || got.JeuUV != jeuUVDiffus || len(got.Couches) != 1 || got.Couches[0].Bitmap != 0xA || got.Couches[0].Normale != 0xB {
		t.Fatalf("feuillage %+v", got)
	}
	pp.textures[1] = 0xC
	got = couchesParNoms(params, pp)
	if got == nil || got.Couches[0].Bitmap != 0xC {
		t.Fatalf("surface existante %+v", got)
	}
}

// TestSurfaceForge lit le shader de structure Forge : couleur de base a l'emplacement 4 (hache
// non resolu), normale et intensite `base_*`, en conservant la priorite des surfaces connues.
func TestSurfaceForge(t *testing.T) {
	params := ParametresShader{0xc8ddb4d2: 4, 0x87794a55: 44, 0xbfd10cd8: 80, 0xca775400: 36}
	pp := postprocessLu{textures: map[int]uint32{4: 0xA, 44: 0xB}}
	got := couchesParNoms(params, pp)
	if got == nil || got.JeuUV != jeuUVDiffus || len(got.Couches) != 1 || got.Couches[0].Bitmap != 0xA || got.Couches[0].Normale != 0xB {
		t.Fatalf("forge %+v", got)
	}
	pp.textures[36] = 0xC
	got = couchesParNoms(params, pp)
	if got == nil || got.Couches[0].Bitmap != 0xC {
		t.Fatalf("surface existante %+v", got)
	}
}

func TestSurfacePanneaux(t *testing.T) {
	for _, tc := range []struct {
		nom      string
		textures map[int]uint32
		bitmap   uint32
	}{
		{"atlas", map[int]uint32{0: 0xA, 32: 0xB}, 0xA},
		{"sans couleur", map[int]uint32{32: 0xB}, 0},
	} {
		t.Run(tc.nom, func(t *testing.T) {
			params := ParametresShader{0xdaef076c: 0, 0x87794a55: 32, 0xbfd10cd8: 64}
			c := make([]byte, 68)
			binary.LittleEndian.PutUint32(c[64:], math.Float32bits(0.75))
			got := couchesParNoms(params, postprocessLu{textures: tc.textures, constantes: c})
			if tc.bitmap == 0 {
				if got != nil {
					t.Fatalf("surface inattendue : %+v", got)
				}
				return
			}
			if got == nil || got.JeuUV != jeuUVDiffus || len(got.Couches) != 1 || got.Couches[0].Bitmap != tc.bitmap || got.Couches[0].Normale != 0xB || got.Couches[0].IntensiteNormale != 0.75 {
				t.Fatalf("surface : %+v", got)
			}
		})
	}
}

// TestSurfaceSansCouleur lit un shader a une surface sans carte de couleur : le degrade est la
// couleur, normale et controle compris ; la carte de controle sert de texture (son rouge porte
// l'indice du degrade).
func TestSurfaceSansCouleur(t *testing.T) {
	c := make([]byte, 232)
	pose := func(o int, v ...float32) {
		for i, f := range v {
			binary.LittleEndian.PutUint32(c[o+4*i:], math.Float32bits(f))
		}
	}
	pose(0, 0.2, 0.3, 0.4)    // haut (top_color)
	pose(16, 0.1, 0.15, 0.2)  // milieu (mid_color)
	pose(32, 0.05, 0.05, 0.1) // bas (bottom_color)
	pose(96, 1.5)             // intensite de la normale
	const (
		nomControle = 0x33056de0 // nom non resolu (carte de controle)
		nomNormale  = 0x0d66c9ce // surface_normal_map
	)
	params := ParametresShader{
		nomControle: 84, nomNormale: 44,
		0x2427bd73: 0, 0x4dd1036e: 16, 0x36d57828: 32, 0x09dad903: 96,
	}
	pp := postprocessLu{textures: map[int]uint32{44: 0xD1, 84: 0xC1}, transfos: map[int]int{44: -1, 84: -1}, constantes: c}
	got := couchesParNoms(params, pp)
	if got == nil || got.JeuUV != jeuUVDiffus || len(got.Couches) != 1 {
		t.Fatalf("sans couleur %+v", got)
	}
	k := got.Couches[0]
	if k.Sorte != CoucheDegrade || k.Bitmap != 0xC1 || k.Transfo != transfoNeutre {
		t.Fatalf("couche %+v", k)
	}
	if k.Normale != 0xD1 || k.Controle != 0xC1 {
		t.Fatalf("relief %+v", k)
	}
	if k.Haut != [3]float32{0.2, 0.3, 0.4} || k.Milieu != [3]float32{0.1, 0.15, 0.2} ||
		k.Bas != [3]float32{0.05, 0.05, 0.1} {
		t.Fatalf("degrade %+v", k)
	}
	if k.IntensiteNormale != 1.5 {
		t.Fatalf("intensite %v", k.IntensiteNormale)
	}
	// la forme de vegetation indexe le degrade par le ROUGE de la carte de controle, pas son alpha.
	if !k.IndiceRouge {
		t.Fatal("la forme de vegetation doit porter l'indiceRouge")
	}
}

// TestSurfaceBaseAlpha : la forme `base_*` (rohg) indexe le degrade par l'ALPHA de la carte de
// controle, pas le rouge : c'est le cas par defaut, oppose a la forme de vegetation.
func TestSurfaceBaseAlpha(t *testing.T) {
	c := make([]byte, 64)
	pose := func(o int, v ...float32) {
		for i, f := range v {
			binary.LittleEndian.PutUint32(c[o+4*i:], math.Float32bits(f))
		}
	}
	pose(0, 0.2, 0.3, 0.4)
	pose(16, 0.1, 0.15, 0.2)
	pose(32, 0.05, 0.05, 0.1)
	base := nomsSurfaces[0]
	params := ParametresShader{base.controle: 84, base.normale: 44,
		base.haut: 0, base.milieu: 16, base.bas: 32, base.intensiteNormale: 48}
	pp := postprocessLu{textures: map[int]uint32{44: 0xD1, 84: 0xC1}, constantes: c}
	got := couchesParNoms(params, pp)
	if got == nil || got.JeuUV != jeuUVDiffus || len(got.Couches) != 1 {
		t.Fatalf("base %+v", got)
	}
	if k := got.Couches[0]; k.Sorte != CoucheDegrade || k.IndiceRouge {
		t.Fatalf("la forme base_* indexe le degrade par l'alpha, pas le rouge : %+v", k)
	}
}

// TestCouchesDiffus : un shader diffus se lit par la table, sur le 1er jeu, teinte comprise.
func TestCouchesDiffus(t *testing.T) {
	c := make([]byte, 64)
	for i, f := range []float32{0.5, 1, 0.25} {
		binary.LittleEndian.PutUint32(c[4*i:], math.Float32bits(f))
	}
	pp := postprocessLu{textures: map[int]uint32{96: 0xB}, constantes: c}
	got := couchesDuMateriau(0x9dc21e00, func(uint32) ParametresShader { t.Fatal("shader diffus lu par ses noms"); return nil }, pp)
	if got == nil || got.JeuUV != jeuUVDiffus || len(got.Couches) != 1 || got.Couches[0].Bitmap != 0xB ||
		got.Couches[0].Teinte != [3]float32{0.5, 1, 0.25} {
		t.Fatalf("diffus %+v", got)
	}
}

// TestEcritGLBCouches verifie l'export d'un materiau en couches : trois jeux de coordonnees,
// `extras.couches` pointant des textures du document, couleur generique de la premiere couche,
// masque macro dont les canaux V, B, A passent en R, V, B.
func TestEcritGLBCouches(t *testing.T) {
	couleur := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	pixel := func(p ...uint8) *image.NRGBA {
		img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
		copy(img.Pix, p)
		return img
	}
	macro, normale, controle := pixel(10, 20, 30, 40), pixel(128, 128, 0, 255), pixel(10, 20, 30, 40)
	m := &MaillageMonde{
		Structure: GroupeMaillage{
			Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0},
			UV:      [NJeuxUV][]float32{{0, 0, 1, 0, 0, 1}, {0, 0, 1, 0, 0, 1}, {0, 0, 4, 0, 0, 4}},
			Indices: map[uint32][]uint32{0xA: {0, 1, 2}},
		},
		Materiaux: map[uint32]Materiau{0xA: {ID: 0xA, Couches: &Couches{Masque: 0xF, JeuUV: jeuUVNiveau, Couches: []Couche{
			{Sorte: CoucheCouleur, Bitmap: 0xC1, Transfo: Transfo{Echelle: [2]float32{2, 2}}, Teinte: [3]float32{1, 0.5, 0.5}, Opacite: 1,
				Normale: 0xD1, IntensiteNormale: 1, Controle: 0xE1},
			{Sorte: CoucheDegrade, Bitmap: 0xC2, Transfo: transfoNeutre, Milieu: [3]float32{0.2, 0.2, 0.2}, Opacite: 0.5, Controle: 0xC2},
			{Sorte: CoucheDegrade, Bitmap: 0xAB5E, Transfo: transfoNeutre, Opacite: 1},
		}}}},
		TexturesCouches: map[uint32]Texture{0xC1: {Image: couleur}, 0xC2: {Image: couleur}, 0xF: {Image: macro},
			0xD1: {Image: normale}, 0xE1: {Image: controle}},
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
	for _, a := range []string{"TEXCOORD_0", "TEXCOORD_1", "TEXCOORD_2"} {
		if _, ok := prim.Attributes[a]; !ok {
			t.Fatalf("%s absent : %+v", a, prim.Attributes)
		}
	}
	mat := doc.Materials[prim.Material]
	if mat.PBR.BaseColorTexture == nil || mat.PBR.BaseColorTexture.TexCoord != jeuUVNiveau || mat.PBR.BaseColorFactor[1] != 0.5 {
		t.Fatalf("couleur generique : %+v", mat.PBR)
	}
	var ex struct {
		Couches struct {
			Masque  int
			Couches []struct {
				Sorte                      string
				Texture, Normale, Controle int
			}
		}
	}
	js, _ := json.Marshal(mat.Extras)
	if err := json.Unmarshal(js, &ex); err != nil {
		t.Fatal(err)
	}
	// couleur, normale, controle de la couche 1, degrade = controle de la couche 2, macro
	if len(ex.Couches.Couches) != 2 || ex.Couches.Couches[1].Sorte != sorteDegradeG || len(doc.Textures) != 5 {
		t.Fatalf("extras %s ; textures %d (couche sans texture omise)", js, len(doc.Textures))
	}
	k1, k2 := ex.Couches.Couches[0], ex.Couches.Couches[1]
	if k2.Controle != k2.Texture || k2.Normale != pasDeTexture {
		t.Fatalf("couche 2 %+v : controle = degrade, sans normale", k2)
	}
	if doc.Images[doc.Textures[k1.Texture].Source].MimeType != mimeJPEG {
		t.Fatal("une carte de couleur sort en JPEG")
	}
	data := b[20+lenJSON+8:]
	pixelPNG := func(tex int, attendu [4]uint32, quoi string) {
		t.Helper()
		vue := doc.BufferViews[doc.Images[doc.Textures[tex].Source].BufferView]
		img, err := png.Decode(bytes.NewReader(data[vue.ByteOffset : vue.ByteOffset+vue.ByteLength]))
		if err != nil {
			t.Fatalf("image %s : %v", quoi, err)
		}
		r, g, bl, a := img.At(0, 0).RGBA()
		if got := [4]uint32{r >> 8, g >> 8, bl >> 8, a >> 8}; got != attendu {
			t.Fatalf("%s %v, attendu %v", quoi, got, attendu)
		}
	}
	pixelPNG(ex.Couches.Masque, [4]uint32{20, 30, 40, 255}, "masque macro (V, B, A en R, V, B)")
	pixelPNG(k1.Normale, [4]uint32{128, 128, 255, 255}, "normale (Z reconstruit)")
	pixelPNG(k1.Controle, [4]uint32{40, 20, 10, 255}, "controle (A, V, R en R, V, B)")
}

// TestEcritGLBDegradeRouge : une couche degrade dont l'indiceRouge est pose exporte une image de
// controle dont le ROUGE est le rouge de la carte (pas son alpha), pour les shaders de vegetation.
func TestEcritGLBDegradeRouge(t *testing.T) {
	// carte de controle : rouge 10, vert 20, bleu 30, alpha 40 (l'alpha n'est PAS le degrade).
	controle := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	copy(controle.Pix, []uint8{10, 20, 30, 40})
	m := &MaillageMonde{
		Structure: GroupeMaillage{
			Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0},
			UV:      [NJeuxUV][]float32{{0, 0, 1, 0, 0, 1}},
			Indices: map[uint32][]uint32{0xA: {0, 1, 2}},
		},
		Materiaux: map[uint32]Materiau{0xA: {ID: 0xA, Couches: &Couches{JeuUV: jeuUVDiffus, Couches: []Couche{
			{Sorte: CoucheDegrade, Bitmap: 0xC1, Controle: 0xC1, IndiceRouge: true,
				Haut: [3]float32{1, 0, 0}, Milieu: [3]float32{0, 1, 0}, Bas: [3]float32{0, 0, 1}, Opacite: 1},
		}}}},
		TexturesCouches: map[uint32]Texture{0xC1: {Image: controle}},
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
	var ex struct {
		Couches struct {
			Couches []struct {
				Sorte   string
				Texture int
			}
		}
	}
	js, _ := json.Marshal(mat.Extras)
	if err := json.Unmarshal(js, &ex); err != nil {
		t.Fatal(err)
	}
	if len(ex.Couches.Couches) != 1 || ex.Couches.Couches[0].Sorte != sorteDegradeG {
		t.Fatalf("extras %s", js)
	}
	tex := ex.Couches.Couches[0].Texture
	vue := doc.BufferViews[doc.Images[doc.Textures[tex].Source].BufferView]
	data := b[20+lenJSON+8:]
	img, err := png.Decode(bytes.NewReader(data[vue.ByteOffset : vue.ByteOffset+vue.ByteLength]))
	if err != nil {
		t.Fatalf("image controle : %v", err)
	}
	r, g, bl, a := img.At(0, 0).RGBA()
	// R = le rouge de la carte (10), V = l'occlusion (20), B = la rugosite (30), A opaque.
	if got := [4]uint32{r >> 8, g >> 8, bl >> 8, a >> 8}; got != [4]uint32{10, 20, 30, 255} {
		t.Fatalf("controle rouge %v, attendu [10 20 30 255] (R = rouge de la carte, pas l'alpha 40)", got)
	}
}
