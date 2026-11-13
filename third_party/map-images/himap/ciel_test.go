package himap

import (
	"bytes"
	"encoding/json"
	"image"
	"testing"
)

func TestCielExport(t *testing.T) {
	m := &MaillageMonde{Structure: GroupeMaillage{Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, Indices: map[uint32][]uint32{0: {0, 1, 2}}}}
	var b bytes.Buffer
	if err := EcritGLBCiel(&b, m, "test", nil, &Ciel{Masque: image.NewGray(image.Rect(0, 0, 2, 2))}); err != nil {
		t.Fatal(err)
	}
	doc, _, err := ouvreGLB(b.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	scene := doc["scenes"].([]any)[0].(map[string]any)
	extras := scene["extras"].(map[string]any)
	ciel := extras["ciel"].(map[string]any)
	if _, ok := ciel["cloudTexture"]; !ok {
		t.Fatal("masque absent")
	}
	if len(doc["images"].([]any)) != 1 {
		t.Fatal("image absente")
	}
}

func TestCielIntensiteNulle(t *testing.T) {
	m := &MaillageMonde{Structure: GroupeMaillage{Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 1, 0}, Indices: map[uint32][]uint32{0: {0, 1, 2}}}}
	zero := 0.0
	var b bytes.Buffer
	if err := EcritGLBCiel(&b, m, "test", nil, &Ciel{IntensiteSoleil: &zero}); err != nil {
		t.Fatal(err)
	}
	doc, _, err := ouvreGLB(b.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	c := doc["scenes"].([]any)[0].(map[string]any)["extras"].(map[string]any)["ciel"].(map[string]any)
	if c["sunIntensity"].(json.Number).String() != "0" {
		t.Fatalf("intensite : %v", c)
	}
}
