package himap

// LOCAL-CHANGE (infinite-theater-3d): the self-illumination texture of diffuse_emissive.

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"testing"
)

func TestBitmapEmissif(t *testing.T) {
	textures := map[int]uint32{96: 0xA, 244: 0xB}
	if got := bitmapEmissif(0x3c7906af, textures); got != 0xB {
		t.Fatalf("diffuse_emissive : %#x", got)
	}
	if got := bitmapEmissif(0x779fc911, textures); got != 0 {
		t.Fatalf("illum_full : %#x", got)
	}
}

// TestEcritGLBTextureEmissive : la texture lue masque la lumiere, sur le jeu de la couleur ; une
// texture absente des modules laisse la lumiere uniforme.
func TestEcritGLBTextureEmissive(t *testing.T) {
	m := &MaillageMonde{
		Structure: GroupeMaillage{Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, Indices: map[uint32][]uint32{1: {0, 1, 2}, 2: {0, 2, 1}}},
		Materiaux: map[uint32]Materiau{
			1: {ID: 1, Emissif: &Emissif{Couleur: [3]float32{1, 0, 0}, Force: 100, Bitmap: 7}},
			2: {ID: 2, Emissif: &Emissif{Couleur: [3]float32{1, 0, 0}, Force: 100, Bitmap: 8}},
		},
		TexturesCouches: map[uint32]Texture{7: *uni(1, 1, 255, 0, 0)},
	}
	var buf bytes.Buffer
	if err := EcritGLB(&buf, m, "test", nil); err != nil {
		t.Fatal(err)
	}
	b := buf.Bytes()
	lenJSON := int(binary.LittleEndian.Uint32(b[12:]))
	var doc struct {
		Materials []struct {
			Name    string `json:"name"`
			Texture *struct {
				Index    int `json:"index"`
				TexCoord int `json:"texCoord"`
			} `json:"emissiveTexture"`
		} `json:"materials"`
	}
	if err := json.Unmarshal(bytes.TrimRight(b[20:20+lenJSON], " "), &doc); err != nil {
		t.Fatal(err)
	}
	vus := 0
	for _, g := range doc.Materials {
		switch g.Name {
		case "mat_00000001":
			vus++
			if g.Texture == nil || g.Texture.TexCoord != jeuUVDiffus {
				t.Fatalf("materiau 1 : %+v", g.Texture)
			}
		case "mat_00000002":
			vus++
			if g.Texture != nil {
				t.Fatalf("materiau 2 : %+v", g.Texture)
			}
		}
	}
	if vus != 2 {
		t.Fatalf("materiaux : %+v", doc.Materials)
	}
}
