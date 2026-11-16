package himap

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"image"
	"math"
	"testing"
)

func constantesAvec(taille int, valeurs map[int]float32) []byte {
	b := make([]byte, taille)
	for o, v := range valeurs {
		binary.LittleEndian.PutUint32(b[o:], math.Float32bits(v))
	}
	return b
}

// TestEmissifDuShader : la table des deux shaders lumineux, les materiaux eteints et les shaders
// inconnus.
func TestEmissifDuShader(t *testing.T) {
	illum := constantesAvec(16, map[int]float32{0: 1, 4: 0.565, 8: 0, 12: 1})
	if e := emissifDuShader(0x779fc911, illum); e == nil || e.Couleur != [3]float32{1, 0.565, 0} || e.Force != 1 {
		t.Fatalf("illum_full : %+v", e)
	}
	diffus := constantesAvec(256, map[int]float32{224: 0.991, 228: 0.761, 232: 0.292, 236: 80, 240: 0.7})
	if e := emissifDuShader(0x3c7906af, diffus); e == nil || math.Abs(float64(e.Force-56)) > 1e-4 {
		t.Fatalf("diffuse_emissive : %+v", e)
	}
	eteint := constantesAvec(256, map[int]float32{224: 1, 228: 1, 232: 1, 236: 0, 240: 1})
	if e := emissifDuShader(0x3c7906af, eteint); e != nil {
		t.Fatalf("quantite nulle : %+v", e)
	}
	if e := emissifDuShader(0x3c7906af, illum); e != nil {
		t.Fatalf("constantes trop courtes : %+v", e)
	}
	if e := emissifDuShader(0x12345678, illum); e != nil {
		t.Fatalf("shader inconnu : %+v", e)
	}
	// LOCAL-CHANGE (infinite-theater-3d): illum, the BR75's light strip (Ekur's export).
	bande := constantesAvec(112, map[int]float32{0: 9, 12: 9, 32: 0, 36: 0.178, 40: 1, 44: 5})
	if e := emissifDuShader(shaderIllum, bande); e == nil || e.Couleur != [3]float32{0, 0.178, 1} || e.Force != 5 {
		t.Fatalf("illum : %+v", e)
	}
	if e := emissifDuShader(shaderIllum, constantesAvec(112, map[int]float32{32: 1, 36: 1, 40: 1})); e != nil {
		t.Fatalf("illum eteint : %+v", e)
	}
}

// TestBitmapEmissifIllum (LOCAL-CHANGE (infinite-theater-3d)): illum's light is its color map.
func TestBitmapEmissifIllum(t *testing.T) {
	if got := bitmapEmissif(shaderIllum, map[int]uint32{0: 0xC, 48: 10098}); got != 0xC {
		t.Fatalf("illum : %#x", got)
	}
}

// TestEmissifParNoms (LOCAL-CHANGE (infinite-theater-3d)): the forms read by parameter names,
// with the layouts of Streets' holographic sign shader (6eb5a1b6) and neon shader (14f680a0).
func TestEmissifParNoms(t *testing.T) {
	enseigne := ParametresShader{nomScanlineMapTexture: 1, nomParallaxDepth: 52, nomEmissiveMapTexture: 0,
		nomEmissiveMap: 0, nomColorTint: 32, nomIntensity: 44, nomOpacity: 48}
	pp := postprocessLu{
		textures:   map[int]uint32{0: 0x96380e41, 64: 0xfb2438bd},
		transfos:   map[int]int{0: 1, 64: 5},
		constantes: constantesAvec(176, map[int]float32{16: 2, 20: 1, 24: 0.5, 32: 1, 36: 0.5, 40: 0.25, 44: 5, 48: 0.6}),
	}
	e := emissifParNoms(enseigne, pp)
	if e == nil || e.Couleur != [3]float32{1, 0.5, 0.25} || math.Abs(float64(e.Force-3)) > 1e-6 || e.Bitmap != 0x96380e41 || !e.Image {
		t.Fatalf("enseigne : %+v", e)
	}
	if e.Transfo == nil || *e.Transfo != (Transfo{Echelle: [2]float32{2, 1}, Decalage: [2]float32{0.5, 0}}) {
		t.Fatalf("transformation : %+v", e.Transfo)
	}
	// Without the names that tell the family apart, generic names light nothing.
	generique := ParametresShader{nomColorTint: 32, nomIntensity: 44, nomOpacity: 48, nomEmissiveMap: 0}
	if e := emissifParNoms(generique, pp); e != nil {
		t.Fatalf("shader generique : %+v", e)
	}
	neon := ParametresShader{nomBaseEmissiveDetailTexture: 4, nomBaseEmissiveDetailMap: 168,
		nomBaseEmissiveCouleurDetail: 224, nomBaseEmissiveIntensity: 236, nomBaseEmissiveAmount: 240}
	pn := postprocessLu{textures: map[int]uint32{4: 0xfd471219, 168: 0xec18d5b4}, transfos: map[int]int{168: -1},
		constantes: constantesAvec(304, map[int]float32{224: 0.745, 228: 0.018, 232: 0.745, 236: 120, 240: 1})}
	e = emissifParNoms(neon, pn)
	if e == nil || e.Force != 120 || e.Bitmap != 0xec18d5b4 || e.Image || e.Couleur[1] != 0.018 {
		t.Fatalf("neon : %+v", e)
	}
	// Dark: a zero intensity or a black color.
	pn.constantes = constantesAvec(304, map[int]float32{224: 1, 228: 1, 232: 1, 236: 0, 240: 1})
	if e := emissifParNoms(neon, pn); e != nil {
		t.Fatalf("neon eteint : %+v", e)
	}
	if e := emissifParNoms(nil, pn); e != nil {
		t.Fatalf("sans parametres : %+v", e)
	}
}

// TestCouleurFoisAlpha (LOCAL-CHANGE (infinite-theater-3d)): a see-through emitter's picture.
func TestCouleurFoisAlpha(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 2, 1))
	copy(img.Pix, []uint8{200, 100, 50, 255, 200, 100, 50, 0})
	got := couleurFoisAlpha(Texture{Image: img})
	if !bytes.Equal(got.Pix, []uint8{200, 100, 50, 255, 0, 0, 0, 255}) {
		t.Fatalf("pixels : %v", got.Pix)
	}
	if got := couleurFoisAlpha(Texture{Image: img, Monocanal: true}); !bytes.Equal(got.Pix, []uint8{200, 100, 50, 255, 200, 100, 50, 255}) {
		t.Fatalf("monocanal : %v", got.Pix)
	}
}

// TestEcritGLBEmissifImage (LOCAL-CHANGE (infinite-theater-3d)): a picture emitter is flagged in
// its extras.
func TestEcritGLBEmissifImage(t *testing.T) {
	g := gltfMaterial{Extras: map[string]any{}}
	e := ecrivainMateriaux{doc: &gltfDoc{}, bin: &tamponGLB{}, m: &MaillageMonde{}}
	e.appliqueImages(&g, Materiau{Emissif: &Emissif{Couleur: [3]float32{1, 1, 0}, Force: 5, Image: true}}, false)
	if g.Extras["emissionImage"] != true || g.EmissiveFactor == nil {
		t.Fatalf("extras : %+v", g)
	}
	g = gltfMaterial{Extras: map[string]any{}}
	e.appliqueImages(&g, Materiau{Emissif: &Emissif{Couleur: [3]float32{1, 1, 0}, Force: 5}}, false)
	if _, ok := g.Extras["emissionImage"]; ok {
		t.Fatalf("masque : %+v", g.Extras)
	}
}

// TestEcritGLBEmissif : couleur ramenee dans [0, 1], excedent dans la force, extension declaree
// une fois ; une force de 1 n'ecrit pas d'extension.
func TestEcritGLBEmissif(t *testing.T) {
	m := &MaillageMonde{
		Structure: GroupeMaillage{Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, Indices: map[uint32][]uint32{1: {0, 1, 2}, 2: {0, 2, 1}}},
		Materiaux: map[uint32]Materiau{
			1: {ID: 1, Emissif: &Emissif{Couleur: [3]float32{2, 1, 0}, Force: 10}},
			2: {ID: 2, Emissif: &Emissif{Couleur: [3]float32{0, 0.5, 1}, Force: 1}},
		},
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	lenJSON := int(binary.LittleEndian.Uint32(b[12:]))
	var doc struct {
		ExtUsed   []string `json:"extensionsUsed"`
		Materials []struct {
			Name       string      `json:"name"`
			Emissive   *[3]float32 `json:"emissiveFactor"`
			Extensions struct {
				Strength *struct {
					Value float32 `json:"emissiveStrength"`
				} `json:"KHR_materials_emissive_strength"`
			} `json:"extensions"`
		} `json:"materials"`
	}
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
		t.Fatal(err)
	}
	n := 0
	for _, x := range doc.ExtUsed {
		if x == extEmissiveStrength {
			n++
		}
	}
	if n != 1 {
		t.Fatalf("extensionsUsed : %v", doc.ExtUsed)
	}
	for _, g := range doc.Materials {
		switch g.Name {
		case "mat_00000001":
			if g.Emissive == nil || *g.Emissive != [3]float32{1, 0.5, 0} || g.Extensions.Strength == nil || g.Extensions.Strength.Value != 20 {
				t.Fatalf("materiau 1 : %+v", g)
			}
		case "mat_00000002":
			if g.Emissive == nil || *g.Emissive != [3]float32{0, 0.5, 1} || g.Extensions.Strength != nil {
				t.Fatalf("materiau 2 : %+v", g)
			}
		}
	}
}

func TestPochoirDuShader(t *testing.T) {
	params := ParametresShader{0x9d5cd716: 16, 0xb4d4ff02: 28}
	b := constantesAvec(32, map[int]float32{16: 0.2, 20: 0.4, 24: 0.8, 28: 0.6})
	p := pochoirDuShader(0xc0b84a6a, params, b)
	if p == nil || p.Couleur != [3]float32{0.2, 0.4, 0.8} || p.Opacite != 0.6 {
		t.Fatalf("pochoir : %+v", p)
	}
	if pochoirDuShader(0, params, b) != nil || pochoirDuShader(0xc0b84a6a, nil, b) != nil || pochoirDuShader(0xc0b84a6a, params, b[:20]) != nil {
		t.Fatal("pochoir illisible accepte")
	}
}

func TestExtrasPochoir(t *testing.T) {
	g := materiauGLTF(1, map[uint32]Materiau{1: {Pochoir: &Pochoir{Couleur: [3]float32{0.2, 0.4, 0.8}, Opacite: 0.6}}})
	b, err := json.Marshal(g.Extras)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(b, []byte(`"pochoir":{"couleur":[0.2,0.4,0.8],"opacite":0.6}`)) {
		t.Fatalf("extras : %s", b)
	}
}
