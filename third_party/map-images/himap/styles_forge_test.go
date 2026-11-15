package himap

// LOCAL-CHANGE (infinite-theater-3d): Forge style materials: the zones an object's own style
// repaints, the composed mask, and the maps laid on UV1 (couches_style.go, styles_forge.go).

import (
	"encoding/json"
	"image"
	"math"
	"testing"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

func procheRGB(got, want [3]float32) bool {
	for i := range got {
		if math.Abs(float64(got[i]-want[i])) > 1e-6 {
			return false
		}
	}
	return true
}

// TestRgbCatalogue : a style color moves the swatch color toward it by its intensity; without an
// intensity the swatch keeps its color.
func TestRgbCatalogue(t *testing.T) {
	c := []float32{0.4, 0.2, 0}
	tint := &mapvar.Vec3{X: 0, Y: 1, Z: 0.5}
	if got := rgbCatalogue(c, mapvar.StyleLayer{}); !procheRGB(got, [3]float32{0.4, 0.2, 0}) {
		t.Errorf("no tint: %v", got)
	}
	if got := rgbCatalogue(c, mapvar.StyleLayer{Tint: tint, Scalar: 0}); !procheRGB(got, [3]float32{0.4, 0.2, 0}) {
		t.Errorf("zero intensity: %v", got)
	}
	if got := rgbCatalogue(c, mapvar.StyleLayer{Tint: tint, Scalar: 0.5}); !procheRGB(got, [3]float32{0.2, 0.6, 0.25}) {
		t.Errorf("half intensity: %v", got)
	}
	if got := rgbCatalogue(c, mapvar.StyleLayer{Tint: tint, Scalar: 3}); !procheRGB(got, [3]float32{0, 1, 0.5}) {
		t.Errorf("intensity above 1: %v", got)
	}
}

// TestLitStylesForge : a style's layers resolve in the catalog by name hash; a disabled swatch
// leaves its zone to the material, the grime needs an amount, and a style naming nothing known
// is left out.
func TestLitStylesForge(t *testing.T) {
	doc := map[string]any{"layers": map[string]any{
		"brick": map[string]any{"name": 11, "layer": map[string]any{
			"gradient_bitmap": 0x51, "normal_bitmap": 0x52, "gradient_transform": []float32{2, 0},
			"mid_color": []float32{0.5, 0.5, 0.5}, "top_color": []float32{1, 1, 1}, "bot_color": []float32{0, 0, 0},
		}},
		"off":  map[string]any{"name": 12, "layer": map[string]any{"disabled": true, "gradient_bitmap": 0x53}},
		"dirt": map[string]any{"name": 13, "layer": map[string]any{"gradient_bitmap": 0x54, "mid_color": []float32{0.3, 0.2, 0.1}}},
	}}
	data, _ := json.Marshal(doc)
	styles := map[int32][]mapvar.StyleLayer{
		1: {{Hash: 11}, {Hash: 12}},
		2: {{Hash: 99}},
		3: {{Hash: 99}},
	}
	grimes := map[int32]mapvar.StyleGrime{1: {Hash: 13, Amount: 0.7}, 3: {Hash: 13, Amount: 0}}
	got, err := LitStylesForge(data, styles, grimes)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[1] == nil {
		t.Fatalf("styles %v, want only style 1", got)
	}
	s := got[1]
	if s.Zones[0] == nil || s.Zones[0].Bitmap != 0x51 || s.Zones[0].Normale != 0x52 || s.Zones[0].Transfo.Echelle != [2]float32{2, 1} {
		t.Errorf("zone 1 = %+v", s.Zones[0])
	}
	if s.Zones[1] != nil {
		t.Errorf("disabled swatch drawn: %+v", s.Zones[1])
	}
	if s.Salete == nil || s.Salete.Bitmap != 0x54 || s.QuantiteSalete != 0.7 {
		t.Errorf("grime %+v amount %v", s.Salete, s.QuantiteSalete)
	}
}

// TestResoutStylesForgeChaine : the game's palette resolves a swatch first, the catalog only the
// swatches the game does not name; a swatch the game knows but disables is not taken from the
// catalog; each zone keeps its rank and its style layer's tint.
func TestResoutStylesForgeChaine(t *testing.T) {
	k := func(b uint32) *Couche {
		return &Couche{Sorte: CoucheDegrade, Bitmap: b, Transfo: transfoNeutre, Haut: [3]float32{1, 1, 1}, Milieu: [3]float32{0.5, 0.5, 0.5}}
	}
	jeu := echantillonForge(func(nom int32) (*Couche, bool) {
		switch nom {
		case 1:
			return k(0x10), true
		case 2:
			return nil, true // known, disabled
		}
		return nil, false
	})
	catalogue := echantillonForge(func(nom int32) (*Couche, bool) {
		switch nom {
		case 1, 2:
			return k(0x90), true
		case 3:
			return k(0x30), true
		}
		return nil, false
	})
	rouge := &mapvar.Vec3{X: 1, Y: 0, Z: 0}
	styles := map[int32][]mapvar.StyleLayer{
		7: {{Hash: 0}, {Hash: 1, Tint: rouge, Scalar: 1}, {Hash: 2}, {Hash: 3}},
		8: {{Hash: 99}},
	}
	got := resoutStylesForge(enChaine(jeu, nil, catalogue), styles, map[int32]mapvar.StyleGrime{7: {Hash: 3, Amount: 0.4}})
	if len(got) != 1 || got[7] == nil {
		t.Fatalf("styles %v, want only style 7", got)
	}
	s := got[7]
	if s.Zones[0] != nil || s.Zones[2] != nil {
		t.Errorf("empty or disabled zone drawn: %+v / %+v", s.Zones[0], s.Zones[2])
	}
	if s.Zones[1] == nil || s.Zones[1].Bitmap != 0x10 || !procheRGB(s.Zones[1].Haut, [3]float32{1, 0, 0}) || !procheRGB(s.Zones[1].Milieu, [3]float32{1, 0, 0}) {
		t.Errorf("zone 2 = %+v, want the game's swatch tinted red", s.Zones[1])
	}
	if s.Zones[3] == nil || s.Zones[3].Bitmap != 0x30 {
		t.Errorf("zone 4 = %+v, want the catalog's swatch", s.Zones[3])
	}
	if s.Salete == nil || s.Salete.Bitmap != 0x30 || s.QuantiteSalete != 0.4 {
		t.Errorf("grime %+v amount %v", s.Salete, s.QuantiteSalete)
	}
}

// TestCompleteTeintesForge : a style the catalog left without a flat tint takes the game
// swatch's middle color times its tint; a catalog tint is kept.
func TestCompleteTeintesForge(t *testing.T) {
	jeu := echantillonForge(func(nom int32) (*Couche, bool) {
		if nom == 5 {
			return &Couche{Milieu: [3]float32{0.5, 0.25, 1}, Matiere: &MatiereCouche{Metal: 0.75}}, true
		}
		return nil, false
	})
	teintes := map[int32]TeinteForge{1: {Couleur: [3]float32{0.25, 0.25, 0.25}, Rugosite: 1}}
	styles := map[int32][]mapvar.StyleLayer{
		1: {{Hash: 5}},
		2: {{Hash: 5, Tint: &mapvar.Vec3{X: 1, Y: 1, Z: 0.5}, Scalar: 0.3}},
		3: {{Hash: 6}},
	}
	got := completeTeintesForge(teintes, jeu, styles)
	if got[1] != teintes[1] {
		t.Errorf("catalog tint replaced: %+v", got[1])
	}
	if want := (TeinteForge{Couleur: [3]float32{0.5, 0.25, 0.5}, Rugosite: 1, Metal: 0.75}); got[2] != want {
		t.Errorf("style 2 = %+v, want %+v", got[2], want)
	}
	if _, ok := got[3]; ok {
		t.Errorf("unknown swatch tinted: %+v", got[3])
	}
	if len(teintes) != 1 {
		t.Errorf("input map modified: %v", teintes)
	}
}

// zonesTest : a three-zone material (base, Mask0 R, Mask0 G) with its own normal, masks and ASG,
// and a grime.
func zonesTest() *ZonesStyle {
	k := func(b uint32) *Couche {
		return &Couche{Sorte: CoucheDegrade, Bitmap: b, Normale: b + 1, Transfo: transfoNeutre, TransfoNormale: transfoNeutre, Opacite: 1}
	}
	return &ZonesStyle{
		zones:          []zoneStyle{{0, k(0x10), poidsAucun}, {1, k(0x20), poidsMasque0R}, {2, k(0x30), poidsMasque0V}},
		salete:         k(0x40),
		quantiteSalete: 1,
		params:         parametresStyle{normale: 0xA0, masque0: 0xA1, asg: 0xA2, densite: [2]float32{1, 1}},
	}
}

// TestZonesStyleCouches : the zones draw in order under the composed mask, with the material's
// own normal and ASG (laid on UV1); an object's style repaints the zones it names and replaces
// the grime.
func TestZonesStyleCouches(t *testing.T) {
	zs := zonesTest()
	c := zs.couches(nil)
	if c == nil || len(c.Couches) != 4 || c.Style == nil {
		t.Fatalf("couches %+v", c)
	}
	for i, want := range []uint32{0x10, 0x20, 0x30, 0x40} {
		k := c.Couches[i]
		if k.Bitmap != want || k.Rang != i || k.Normale != 0xA0 || !k.NormaleObjet || k.Controle != 0xA2 || !k.ControleASG {
			t.Errorf("couche %d = %+v", i, k)
		}
	}
	if c.Style.Canaux != [3]SourcePoids{poidsMasque0R, poidsMasque0V, poidsSalete} || c.Style.Masque0 != 0xA1 || c.Style.ASG != 0xA2 {
		t.Errorf("mask %+v", c.Style)
	}

	s := &StyleForge{Salete: &Couche{Sorte: CoucheDegrade, Bitmap: 0x50, Transfo: transfoNeutre}, QuantiteSalete: 0.5}
	s.Zones[1] = &Couche{Sorte: CoucheDegrade, Bitmap: 0x60, Transfo: transfoNeutre}
	c = zs.couches(s)
	if c == nil || len(c.Couches) != 4 {
		t.Fatalf("styled couches %+v", c)
	}
	if c.Couches[0].Bitmap != 0x10 || c.Couches[1].Bitmap != 0x60 || c.Couches[3].Bitmap != 0x50 || c.Style.Salete != 0.5 {
		t.Errorf("styled = %+v / %+v", c.Couches, c.Style)
	}
}

// TestZonesStyleTronque : the viewer composes four layers; the zones past the third mask channel
// (and the grime after them) are dropped, never the base.
func TestZonesStyleTronque(t *testing.T) {
	zs := zonesTest()
	zs.zones = append(zs.zones, zoneStyle{3, &Couche{Bitmap: 0x70, Transfo: transfoNeutre}, poidsMasque0B}, zoneStyle{4, &Couche{Bitmap: 0x80, Transfo: transfoNeutre}, poidsMasque1R})
	c := zs.couches(nil)
	if c == nil || len(c.Couches) != 4 || c.Couches[0].Bitmap != 0x10 || c.Couches[3].Bitmap != 0x70 {
		t.Fatalf("couches %+v", c)
	}
}

// TestDecoupeMasqueStyle : a transparent base intention cuts on UV1: the composed mask carries the
// opacity (the ASG alpha, cut where it is low) in its alpha, the GLB says so (`decoupeMasque`)
// and flags the maps laid on the mask's coordinates; no color copy is written.
func TestDecoupeMasqueStyle(t *testing.T) {
	zs := zonesTest()
	zs.decoupe = true
	c := zs.couches(nil)
	img := func(px [4]uint8) *image.NRGBA {
		m := image.NewNRGBA(image.Rect(0, 0, 2, 1))
		copy(m.Pix, []uint8{px[0], px[1], px[2], px[3], px[0], px[1], px[2], 255 - px[3]})
		return m
	}
	tex := map[uint32]Texture{}
	for _, id := range []uint32{0x10, 0x20, 0x30, 0x40, 0xA0} {
		tex[id] = Texture{Image: img([4]uint8{128, 128, 128, 255})}
	}
	tex[0xA1] = Texture{Image: img([4]uint8{200, 100, 0, 255})}
	tex[0xA2] = Texture{Image: img([4]uint8{255, 0, 255, 64})}
	if got := composeMasqueStyle(MasqueStyle{Masque0: 0xA1, ASG: 0xA2, Canaux: c.Style.Canaux, Salete: 1, Decoupe: true}, tex); got.Pix[3] != 64 || got.Pix[7] != 191 || got.Pix[0] != 200 || got.Pix[1] != 100 || got.Pix[2] != 255 {
		t.Fatalf("mask pixels %v", got.Pix)
	}
	d := &Decoupe{Bitmap: 0xA2, Echelle: [2]float32{1, 1}, Puissance: 1, Seuil: 0.5, AlphaSeul: true}
	asg := tex[0xA2]
	g := &gltfMaterial{Extras: map[string]any{}}
	doc := &gltfDoc{}
	if err := (&couchesGLB{}).applique(doc, &tamponGLB{}, g, c, tex, nouveauDecoupe(&asg, d)); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(g.Extras["couches"])
	var lu struct {
		Masque        int              `json:"masque"`
		JeuMasque     int              `json:"jeuMasque"`
		DecoupeMasque bool             `json:"decoupeMasque"`
		Couches       []map[string]any `json:"couches"`
	}
	if err := json.Unmarshal(raw, &lu); err != nil {
		t.Fatal(err)
	}
	if lu.Masque < 0 || lu.JeuMasque != jeuUVMacro || !lu.DecoupeMasque || len(lu.Couches) != 4 {
		t.Fatalf("export %s", raw)
	}
	for i, k := range lu.Couches {
		if k["normaleMacro"] != true || k["controleMacro"] != true {
			t.Errorf("couche %d not laid on the mask set: %v", i, k)
		}
	}
	// Images: four layers' gradients, the shared normal and ASG, and the composed mask; no
	// color copy for the cut.
	if len(doc.Images) != 7 {
		t.Errorf("%d images, want 7", len(doc.Images))
	}
}
