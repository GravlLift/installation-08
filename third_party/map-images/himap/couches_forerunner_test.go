package himap

import (
	"encoding/binary"
	"math"
	"testing"
)

// TestBaseForerunner (LOCAL-CHANGE (infinite-theater-3d)): a level shader that declares the
// template's layer 2 but not its layer 1, and the Forerunner base names, gets that base under its
// layer 2. The values are Origin's Forerunner Support C material (3481445988, shader 71c12c90).
func TestBaseForerunner(t *testing.T) {
	constantes := make([]byte, 1024)
	put := func(o int, v ...float32) {
		for i, f := range v {
			binary.LittleEndian.PutUint32(constantes[o+4*i:], math.Float32bits(f))
		}
	}
	put(192, 0.287, 0.332, 0.429) // 0xaf44c1b5
	put(288, 0.279, 0.314, 0.402) // 0x0a1b7f9b
	put(352, 0.356, 0.392, 0.497) // 0x16855291
	put(672, 0.144, 0.181, 0.258) // layer 2 top
	params := ParametresShader{
		forerunnerControle: 132, forerunnerNormale: 84,
		forerunnerMilieu: 192, forerunnerBas: 288, forerunnerHaut: 352,
		nomsCouches[1].controle: 644, nomsCouches[1].haut: 672,
	}
	pp := postprocessLu{textures: map[int]uint32{132: 0x4b3dc147, 84: 0x0e82cd64, 644: 0x2c8e996e}, transfos: map[int]int{}, constantes: constantes}
	out := couchesDeNiveau(params, pp)
	if out == nil || len(out.Couches) != 2 {
		t.Fatalf("layers %+v", out)
	}
	b := out.Couches[0]
	if b.Rang != 0 || b.Sorte != CoucheDegrade || !b.IndiceRouge || b.Bitmap != 0x4b3dc147 || b.Controle != 0x4b3dc147 || b.Normale != 0x0e82cd64 {
		t.Fatalf("base %+v", b)
	}
	if b.Bas != [3]float32{0.279, 0.314, 0.402} || b.Milieu != [3]float32{0.287, 0.332, 0.429} || b.Haut != [3]float32{0.356, 0.392, 0.497} {
		t.Fatalf("base colors %v %v %v", b.Bas, b.Milieu, b.Haut)
	}
	if out.Couches[1].Rang != 1 || out.Couches[1].Bitmap != 0x2c8e996e {
		t.Fatalf("layer 2 %+v", out.Couches[1])
	}
	// Without the Forerunner colors the layers stay as read.
	delete(params, forerunnerHaut)
	if out := couchesDeNiveau(params, pp); out == nil || len(out.Couches) != 1 || out.Couches[0].Rang != 1 {
		t.Fatalf("base added without its colors: %+v", out)
	}
}
