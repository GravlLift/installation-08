package himap

import (
	"bytes"
	"encoding/json"
	"image/png"
	"testing"
)

// TestSurfacesBrutesGLB : une piece a surfaces brutes publie ses images telles quelles (une par
// bitmap), sans couleur cuite, et les nomme dans `extras.surfaceBrute` ; le masque absent vaut -1.
func TestSurfacesBrutesGLB(t *testing.T) {
	m := modeleTexture()
	m.Maillage.SurfacesBrutes = true
	// Le masque B est l'image vide du jeu (un pixel blanc) : absent, comme un masque non lie.
	m.Maillage.Materiaux[0xA].Surface.MasqueB = 4
	m.Maillage.TexturesCouches[4] = *uni(1, 1, 255, 255, 255)
	var buf bytes.Buffer
	if err := EcritGLBPeau(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	doc, _, err := ouvreGLB(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	mats, _ := doc["materials"].([]any)
	if len(mats) != 1 {
		t.Fatalf("%d materiaux", len(mats))
	}
	mat, _ := mats[0].(map[string]any)
	pbr, _ := mat["pbrMetallicRoughness"].(map[string]any)
	if _, cuite := pbr["baseColorTexture"]; cuite {
		t.Fatal("couleur cuite publiee sur une surface brute")
	}
	extras, _ := mat["extras"].(map[string]any)
	brute, _ := extras[CleSurfaceBrute].(map[string]any)
	if brute == nil || brute["asg"] != json.Number("0") || brute["masque0"] != json.Number("1") || brute["masque1"] != json.Number("-1") {
		t.Fatalf("extras %v", extras)
	}
	bitmaps, _ := brute["bitmaps"].(map[string]any)
	if bitmaps["asg"] != json.Number("2") || bitmaps["masque0"] != json.Number("1") || bitmaps["masque1"] != json.Number("4") {
		t.Fatalf("bitmaps %v", bitmaps)
	}
	if images, _ := doc["images"].([]any); len(images) != 3 {
		t.Fatalf("%d images : attendu asg, masque 0, normale", len(images))
	}
	if _, ok := mat["normalTexture"]; !ok {
		t.Fatal("normale absente")
	}
}

// TestPNGBrut : les canaux passent tels quels ; une image a un canal ne garde que R.
func TestPNGBrut(t *testing.T) {
	for _, c := range []struct {
		mono    bool
		g, b    uint8
		attendu [3]uint8
	}{{false, 20, 30, [3]uint8{10, 20, 30}}, {true, 10, 10, [3]uint8{10, 0, 0}}} {
		tex := uni(2, 2, 10, c.g, c.b)
		tex.Monocanal = c.mono
		octets, err := PNGBrut(*tex)
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(bytes.NewReader(octets))
		if err != nil {
			t.Fatal(err)
		}
		r, g, b, a := img.At(1, 1).RGBA()
		if [3]uint8{uint8(r >> 8), uint8(g >> 8), uint8(b >> 8)} != c.attendu || a>>8 != 255 {
			t.Fatalf("mono=%v : pixel %d %d %d %d", c.mono, r>>8, g>>8, b>>8, a>>8)
		}
	}
}
