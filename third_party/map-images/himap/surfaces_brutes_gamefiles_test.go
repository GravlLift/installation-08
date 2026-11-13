//go:build gamefiles

package himap

import (
	"bytes"
	"context"
	"image/png"
	"testing"
)

// imagesVidesDuJeu : les bitmaps d'un pixel blanc que le jeu lie a un emplacement sans masque
// (mesures sur les pieces d'armure), que himap ne publie pas.
var imagesVidesDuJeu = map[uint32]bool{9504: true, 10098: true, 15173: true}

// TestSurfacesBrutesPiece : le casque Aristos (e5f7f02b-71a1b127) publie ses surfaces dures en images
// brutes (asg toujours, masque 0 sur au moins un materiau, decodables), aucune couleur cuite ; un
// masque non publie nomme une image vide du jeu ; deux images de nuancier d'un revetement reel
// (degrade et salissure d'Avalanche Slate, d'apres la reference Ekur) se lisent a coteNuancier.
func TestSurfacesBrutesPiece(t *testing.T) {
	a, r := ouvreArmurerieRecharge(t)
	m, err := r.Piece(context.Background(), CleArmure{Region: 0xe5f7f02b, Permutation: 0x71a1b127})
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := EcritGLBPeau(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	doc, bin, err := ouvreGLB(buf.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	mats, _ := doc["materials"].([]any)
	brutes, masques := 0, 0
	for _, x := range mats {
		mat, _ := x.(map[string]any)
		extras, _ := mat["extras"].(map[string]any)
		brute, _ := extras[CleSurfaceBrute].(map[string]any)
		if brute == nil {
			continue
		}
		brutes++
		pbr, _ := mat["pbrMetallicRoughness"].(map[string]any)
		if _, cuite := pbr["baseColorTexture"]; cuite {
			t.Fatalf("%v : couleur cuite", mat["name"])
		}
		bitmaps, _ := brute["bitmaps"].(map[string]any)
		for _, cle := range []string{"asg", "masque0", "masque1"} {
			rang, _ := entier(brute[cle])
			if rang >= 0 {
				verifieImageDecodable(t, doc, bin, rang)
				if cle == "masque0" {
					masques++
				}
				continue
			}
			if id, _ := NombreJSON(bitmaps[cle]); cle == "asg" || !imagesVidesDuJeu[id] {
				t.Fatalf("%v : %s absent sans etre l'image vide du jeu (%v)", mat["name"], cle, brute)
			}
		}
	}
	if brutes == 0 || masques == 0 {
		t.Fatalf("%d materiaux a surface brute, %d masques 0 publies", brutes, masques)
	}
	for _, id := range []uint32{0xc5e192fb, 0x5d0a1114} {
		octets, err := a.Nuancier(id)
		if err != nil {
			t.Fatal(err)
		}
		img, err := png.Decode(bytes.NewReader(octets))
		if err != nil {
			t.Fatal(err)
		}
		if b := img.Bounds(); b.Dx() != coteNuancier || b.Dy() != coteNuancier {
			t.Fatalf("nuancier %08x : %dx%d", id, b.Dx(), b.Dy())
		}
	}
	t.Logf("%d materiaux a surface brute sur %d", brutes, len(mats))
}

// verifieImageDecodable : la texture glTF `rang` porte un PNG decodable.
func verifieImageDecodable(t *testing.T, doc map[string]any, bin []byte, rang int) {
	t.Helper()
	textures, _ := doc["textures"].([]any)
	tex, _ := textures[rang].(map[string]any)
	src, _ := entier(tex["source"])
	images, _ := doc["images"].([]any)
	img, _ := images[src].(map[string]any)
	bv, _ := entier(img["bufferView"])
	vues, _ := doc["bufferViews"].([]any)
	octets, err := octetsDeVue(vues[bv], bin)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := png.Decode(bytes.NewReader(octets)); err != nil {
		t.Fatalf("texture %d : %v", rang, err)
	}
}
