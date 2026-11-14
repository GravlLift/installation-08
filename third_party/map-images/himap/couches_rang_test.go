package himap

// LOCAL-CHANGE (infinite-theater-3d): a level shader that skips a template layer keeps each
// layer's template rank (Couche.Rang) through to the GLB.

import (
	"encoding/json"
	"image"
	"testing"
)

// TestRangCoucheSautee : layers 1, 2 and 4 declared (Live Fire's boulder shader 804d3276); the
// third written layer is template layer 4 and says so, the others keep their position.
func TestRangCoucheSautee(t *testing.T) {
	c := make([]byte, 64)
	p := ParametresShader{nomsCouches[0].couleur: 0, nomsCouches[1].couleur: 2, nomsCouches[3].couleur: 4}
	got := couchesDeNiveau(p, postprocessLu{constantes: c, textures: map[int]uint32{0: 1, 2: 2, 4: 3}})
	if got == nil || len(got.Couches) != 3 {
		t.Fatalf("couches %+v", got)
	}
	for i, want := range []int{0, 1, 3} {
		if got.Couches[i].Rang != want {
			t.Fatalf("couche %d : rang %d, attendu %d", i, got.Couches[i].Rang, want)
		}
	}
	img := image.NewNRGBA(image.Rect(0, 0, 1, 1))
	g := &gltfMaterial{Extras: map[string]any{}}
	err := (&couchesGLB{}).applique(&gltfDoc{}, &tamponGLB{}, g, got, map[uint32]Texture{1: {Image: img}, 2: {Image: img}, 3: {Image: img}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(g.Extras["couches"])
	var lu struct {
		Couches []map[string]any `json:"couches"`
	}
	if err := json.Unmarshal(raw, &lu); err != nil || len(lu.Couches) != 3 {
		t.Fatalf("export %s", raw)
	}
	for i, want := range []any{nil, nil, float64(3)} {
		if lu.Couches[i]["rang"] != want {
			t.Fatalf("couche %d : rang %v, attendu %v", i, lu.Couches[i]["rang"], want)
		}
	}
}
