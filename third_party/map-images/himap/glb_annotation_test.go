package himap

import (
	"bytes"
	"testing"
)

// TestAnnoteMateriauxGLB : l'appelant lit l'identifiant d'un materiau et y ajoute un champ ; le reste
// du document passe tel quel ; sans changement, les octets sont rendus a l'identique.
func TestAnnoteMateriauxGLB(t *testing.T) {
	var buf bytes.Buffer
	if err := EcritGLBPeau(&buf, modeleTexture(), "test", nil); err != nil {
		t.Fatal(err)
	}
	avant := buf.Bytes()
	vus := 0
	apres, err := AnnoteMateriauxGLB(avant, func(extras map[string]any) bool {
		id, ok := NombreJSON(extras["id"])
		if !ok || id != 0xA {
			t.Fatalf("id %v", extras["id"])
		}
		vus++
		extras["style"] = map[string]any{"stylelist": "0000000b"}
		return true
	})
	if err != nil || vus != 1 {
		t.Fatalf("err %v, %d materiaux", err, vus)
	}
	doc, _, err := ouvreGLB(apres)
	if err != nil {
		t.Fatal(err)
	}
	mat, _ := doc["materials"].([]any)[0].(map[string]any)
	extras, _ := mat["extras"].(map[string]any)
	style, _ := extras["style"].(map[string]any)
	if style["stylelist"] != "0000000b" || extras["surfaceDure"] != true {
		t.Fatalf("extras %v", extras)
	}
	if images, _ := doc["images"].([]any); len(images) != 3 {
		t.Fatalf("%d images apres annotation", len(images))
	}
	pareil, err := AnnoteMateriauxGLB(avant, func(map[string]any) bool { return false })
	if err != nil || !bytes.Equal(pareil, avant) {
		t.Fatalf("sans changement : err %v, octets differents", err)
	}
}
