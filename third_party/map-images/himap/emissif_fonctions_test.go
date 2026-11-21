package himap

// LOCAL-CHANGE (infinite-theater-3d): the animated parameters of a light (emissif_fonctions.go).

import (
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

// fonctionPeriodiqueOctets builds a game mapping function: periodic, output [hmin, hmax], one
// sub-function per wave.
func fonctionPeriodiqueOctets(hmin, hmax float32, ondes ...Periodique) []byte {
	b := make([]byte, 32+20*len(ondes))
	b[0] = fonctionPeriodique
	if len(ondes) > 1 {
		b[1] = 1
	}
	binary.LittleEndian.PutUint32(b[4:], math.Float32bits(hmin))
	binary.LittleEndian.PutUint32(b[8:], math.Float32bits(hmax))
	binary.LittleEndian.PutUint32(b[28:], uint32(20*len(ondes)))
	for i, o := range ondes {
		s := b[32+20*i:]
		s[0] = byte(o.Onde)
		for k, v := range []float32{o.Frequence, o.Phase, o.Min, o.Max} {
			binary.LittleEndian.PutUint32(s[4+4*k:], math.Float32bits(v))
		}
	}
	return b
}

func TestLitFonctionJeu(t *testing.T) {
	f, ok := litFonctionJeu(fonctionPeriodiqueOctets(0.15, 0.4, Periodique{Onde: 10, Frequence: 0.2, Max: 1}, Periodique{Onde: 0, Frequence: 0.1, Max: 1}))
	if !ok || f.Type != fonctionPeriodique || !f.Plage || f.Min != 0.15 || f.Max != 0.4 || len(f.Periodiques) != 2 || f.Periodiques[0] != (Periodique{Onde: 10, Frequence: 0.2, Max: 1}) {
		t.Fatalf("periodique : %+v %v", f, ok)
	}
	if _, ok := litFonctionJeu(make([]byte, 20)); ok {
		t.Fatal("trop court")
	}
	// The FREE sign's color function: two colors at +4 and +16, white then c8d8ff.
	couleur := fonctionPeriodiqueOctets(0, 0, Periodique{Onde: 9, Frequence: 0.5, Max: 1})
	couleur[2] = 2
	binary.LittleEndian.PutUint32(couleur[4:], 0xffffffff)
	binary.LittleEndian.PutUint32(couleur[16:], 0xffc8d8ff)
	f, _ = litFonctionJeu(couleur)
	c := f.couleurs()
	if f.Min != 0 || len(c) != 2 || c[0] != [3]float32{1, 1, 1} || math.Abs(float64(c[1][0]-0.5775804)) > 1e-4 || c[1][2] != 1 {
		t.Fatalf("couleurs : %v (%+v)", c, f)
	}
}

// TestAnimationsEmissives: a sign's opacity and picture scroll are drawn; its scanline texture's
// scroll, a function on an object input and a constant function are not.
func TestAnimationsEmissives(t *testing.T) {
	onde := func(o int, fr float32) FonctionJeu {
		return FonctionJeu{Type: fonctionPeriodique, Min: 0, Max: 1, Periodiques: []Periodique{{Onde: o, Frequence: fr, Max: 1}}}
	}
	e := &Emissif{octets: cibleEmissive{couleur: 32, intensite: 44, quantite: 48, emplacement: 0}}
	pp := postprocessLu{
		transfos:   map[int]int{0: 1, 64: 5},
		constantes: constantesAvec(176, map[int]float32{44: 5, 48: 0.5}),
		animes: []ParametreAnime{
			{Sorte: AnimeValeur, Octet: 48, Periode: 1, Fonction: FonctionJeu{Type: fonctionPeriodique, Min: 0.25, Max: 1, Periodiques: []Periodique{{Onde: 10, Frequence: 0.2, Max: 1}}}},
			{Sorte: AnimeDecalageY, Octet: 16, Periode: 1, Fonction: onde(6, 0.3)},
			{Sorte: AnimeEchelle, Octet: 16, Periode: 1, Fonction: onde(2, 1)},
			{Sorte: AnimeDecalageX, Octet: 80, Periode: 1, Fonction: onde(6, 0.5)},                // the scanline texture (reg 5)
			{Sorte: AnimeValeur, Octet: 44, Entree: 0xeb2b154d, Periode: 1, Fonction: onde(9, 1)}, // an object input
			{Sorte: AnimeDecalageY, Octet: 16, Periode: 1, Fonction: FonctionJeu{Type: 1, Min: 0, Max: 1}},
		},
	}
	got := animationsEmissives(e, pp)
	b, _ := json.Marshal(got)
	if len(got) != 4 {
		t.Fatalf("animations : %s", b)
	}
	if got[0].Cible != CibleForce || got[0].Fonction.Min != 0.5 || got[0].Fonction.Max != 2 {
		t.Fatalf("opacite : %s", b)
	}
	if got[1].Cible != CibleUV || got[1].Composante != 3 || got[2].Composante != 0 || got[3].Composante != 1 {
		t.Fatalf("uv : %s", b)
	}
	if got := animationsEmissives(&Emissif{octets: cibleEmissive{couleur: 32, intensite: 44, quantite: -1, emplacement: -1}}, postprocessLu{}); got != nil {
		t.Fatalf("immobile : %+v", got)
	}
}

// LOCAL-CHANGE (infinite-theater-3d): object-driven color mappings survive material export.
func TestObjetEmissif(t *testing.T) {
	e := &Emissif{octets: cibleEmissive{couleur: 224}}
	pp := postprocessLu{animes: []ParametreAnime{
		{Sorte: AnimeCouleur, Octet: 224, Entree: 0x4a2c3a6a, Donnees: []byte{0, 1, 2}},
		{Sorte: AnimeCouleur, Octet: 16, Entree: 1, Donnees: []byte{3}},
		{Sorte: AnimeCouleur, Octet: 224, Entree: 0, Donnees: []byte{4}},
	}}
	got := objetsEmissifs(e, pp)
	if len(got) != 1 || got[0].Entree != 0x4a2c3a6a || string(got[0].Donnees) != string([]byte{0, 1, 2}) {
		t.Fatalf("object emissive mappings: %+v", got)
	}
	g := gltfMaterial{Extras: map[string]any{}}
	w := ecrivainMateriaux{doc: &gltfDoc{}, bin: &tamponGLB{}, m: &MaillageMonde{}}
	w.appliqueImages(&g, Materiau{Emissif: &Emissif{Couleur: [3]float32{1, 1, 1}, Force: 1, Objets: got}}, false)
	if g.Extras["emissionObject"] == nil {
		t.Fatal("object mapping missing from GLB extras")
	}
}

// TestEcritGLBAnimationEmissive: the animations go into the material's extras; a still light
// writes none.
func TestEcritGLBAnimationEmissive(t *testing.T) {
	e := ecrivainMateriaux{doc: &gltfDoc{}, bin: &tamponGLB{}, m: &MaillageMonde{}}
	anim := []AnimationEmissive{{Cible: CibleForce, Periode: 1, Fonction: FonctionJeu{Type: fonctionPeriodique, Min: 1, Max: 0.5, Periodiques: []Periodique{{Onde: 10, Frequence: 0.2, Max: 1}}}}}
	g := gltfMaterial{Extras: map[string]any{}}
	e.appliqueImages(&g, Materiau{Emissif: &Emissif{Couleur: [3]float32{1, 0, 1}, Force: 120, Animations: anim}}, false)
	b, _ := json.Marshal(g.Extras["emissionAnim"])
	if string(b) != `[{"cible":"force","periode":1,"fonction":{"type":3,"min":1,"max":0.5,"periodiques":[{"onde":10,"frequence":0.2,"phase":0,"min":0,"max":1}]}}]` {
		t.Fatalf("extras : %s", b)
	}
	g = gltfMaterial{Extras: map[string]any{}}
	e.appliqueImages(&g, Materiau{Emissif: &Emissif{Couleur: [3]float32{1, 0, 1}, Force: 120}}, false)
	if _, ok := g.Extras["emissionAnim"]; ok {
		t.Fatalf("immobile : %+v", g.Extras)
	}
}
