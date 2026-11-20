package himap

// LOCAL-CHANGE (infinite-theater-3d): a light whose image an object input picks (an ammo counter's
// digit, emissif_fonctions.go ImagesEmissives), and the strip the GLB writes for it.

import (
	"encoding/binary"
	"encoding/json"
	"image"
	"math"
	"testing"
)

// The BR75's counter digit as the tag holds it: the identity function, output 0..10 (bytes read off
// material 678fd324), on its object input.
func fonctionChiffre() FonctionJeu {
	b := make([]byte, 32)
	b[1] = 0x34
	binary.LittleEndian.PutUint32(b[8:], math.Float32bits(10))
	f, _ := litFonctionJeu(b)
	return f
}

func TestImagesEmissives(t *testing.T) {
	chiffre := ParametreAnime{Sorte: AnimeImage, Octet: 4, Entree: 0x96e4a1a4, Fonction: fonctionChiffre()}
	got := imagesEmissives(postprocessLu{animes: []ParametreAnime{{Sorte: AnimeValeur, Octet: 44, Fonction: fonctionChiffre()}, chiffre}})
	if got == nil || *got != (ImagesEmissives{Entree: 0x96e4a1a4, Min: 0, Max: 10}) {
		t.Fatalf("digit: %+v", got)
	}
	// A flipbook over time is not an object input's image.
	temps := chiffre
	temps.Entree = 0
	if got := imagesEmissives(postprocessLu{animes: []ParametreAnime{temps}}); got != nil {
		t.Fatalf("over time: %+v", got)
	}
}

func TestGLBImagesEmissives(t *testing.T) {
	const bitmap = 0x7c35f8df
	mat := Materiau{ID: 0x678fd324, Shader: shaderIllum, Melange: MelangeAdditif,
		Emissif: &Emissif{Couleur: [3]float32{0, 0.18, 1}, Force: 5, Bitmap: bitmap, Images: &ImagesEmissives{Entree: 0x96e4a1a4, Max: 10}}}
	m := &MaillageMonde{Materiaux: map[uint32]Materiau{mat.ID: mat}, TexturesCouches: map[uint32]Texture{bitmap: {Image: image.NewNRGBA(image.Rect(0, 0, 40, 4))}},
		ImagesEmissives: map[uint32]int{bitmap: 10}}
	doc := &gltfDoc{}
	e := ecrivainMateriaux{doc: doc, bin: &tamponGLB{}, m: m, rangs: map[uint32]int{}}
	g := doc.Materials[e.rang(mat.ID)]
	if e.err != nil || g.EmissiveTexture == nil {
		t.Fatalf("no emissive texture: %v", e.err)
	}
	js, _ := json.Marshal(g.EmissiveTexture.Extensions)
	if string(js) != `{"KHR_texture_transform":{"offset":[0,0],"scale":[0.1,1]}}` {
		t.Fatalf("transform: %s", js)
	}
	js, _ = json.Marshal(g.Extras["emissionImages"])
	if string(js) != `{"entree":2531565988,"max":10,"min":0,"nombre":10}` {
		t.Fatalf("extras: %s", js)
	}
}
