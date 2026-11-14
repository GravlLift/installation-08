package himap

// LOCAL-CHANGE (infinite-theater-3d): tests of the terrain decorators (decorateurs*.go,
// glb_decorateurs.go) and their foliage material.

import (
	"encoding/binary"
	"math"
	"testing"
)

// TestSurfaceDecorateur reads the grass clump shader: no color map, a gradient indexed by the red
// of the control map; without its gradient colors declared, the shader has no surface.
func TestSurfaceDecorateur(t *testing.T) {
	c := make([]byte, 144)
	pose := func(o int, v ...float32) {
		for i, f := range v {
			binary.LittleEndian.PutUint32(c[o+4*i:], math.Float32bits(f))
		}
	}
	pose(32, 0.15, 0.16, 0.01)
	pose(48, 0.11, 0.12, 0.05)
	pose(64, 0.03, 0.07, 0.004)
	params := ParametresShader{0x255bb2ea: 112, 0xd014dac9: 76, 0x060b3ab4: 32, 0xc09a725d: 48, 0x40853e37: 64}
	pp := postprocessLu{textures: map[int]uint32{76: 0xA1, 112: 0xC1}, transfos: map[int]int{76: -1, 112: -1}, constantes: c}
	got := couchesParNoms(params, pp)
	if got == nil || len(got.Couches) != 1 {
		t.Fatalf("surface %+v", got)
	}
	k := got.Couches[0]
	if k.Sorte != CoucheDegrade || k.Bitmap != 0xC1 || k.Controle != 0xC1 || !k.IndiceRouge {
		t.Fatalf("couche %+v", k)
	}
	if k.Haut != [3]float32{0.15, 0.16, 0.01} || k.Milieu != [3]float32{0.11, 0.12, 0.05} || k.Bas != [3]float32{0.03, 0.07, 0.004} {
		t.Fatalf("degrade %+v", k)
	}
	delete(params, 0x060b3ab4)
	if got := couchesParNoms(params, pp); got != nil {
		t.Fatalf("sans couleurs declarees : %+v", got)
	}
}

// TestDecoupeDecorateur : the clump shaders cut out by the alpha of their slot-76 map.
func TestDecoupeDecorateur(t *testing.T) {
	for _, s := range []uint32{0xbd7bb1c4, 0xd313108e} {
		d := decoupeDuShader(s, map[int]uint32{76: 0xA1, 112: 0xC1}, nil)
		if d == nil || d.Bitmap != 0xA1 || d.Seuil != seuilDecoupeDefaut {
			t.Fatalf("shader %08x : %+v", s, d)
		}
	}
}

func TestHasardReproductible(t *testing.T) {
	a, b := hasard(42), hasard(42)
	for i := 0; i < 100; i++ {
		x, y := a.suivant(), b.suivant()
		if x != y || x < 0 || x >= 1 {
			t.Fatalf("tirage %d : %v %v", i, x, y)
		}
	}
}

// TestHauteurTuile : bilinear height on a 2x2-cell tile, rows stored from the top.
func TestHauteurTuile(t *testing.T) {
	const res = 2
	h := make([]byte, 2*(res+1)*(res+1))
	// height = x/2 * 65535 on every row
	for row := 0; row <= res; row++ {
		for x := 0; x <= res; x++ {
			binary.LittleEndian.PutUint16(h[2*(row*(res+1)+x):], uint16(x*65535/2))
		}
	}
	tile := tuileTerrain{Hauteurs: h}
	for _, c := range []struct{ gx, gy, want float64 }{{0, 0, 0}, {2, 2, 1}, {1, 0.5, 0.5}, {0.5, 1.7, 0.25}, {-1, 5, 0}} {
		if got := hauteurTuile(tile, res, c.gx, c.gy); math.Abs(got-c.want) > 1e-4 {
			t.Fatalf("(%v, %v) = %v, attendu %v", c.gx, c.gy, got, c.want)
		}
	}
}

// TestAjouteDecorateurs writes a carpet as one instanced node: its transforms in glTF axes.
func TestAjouteDecorateurs(t *testing.T) {
	doc := &gltfDoc{}
	bin := &tamponGLB{}
	g := GroupeMaillage{Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 0, 1}, Normales: []float32{0, 0, 1, 0, 0, 1, 0, 0, 1},
		Indices: map[uint32][]uint32{7: {0, 1, 2}}, Instances: 1}
	tapis := []TapisDecorateur{
		{Nom: "decorHerbe_test_0", Maillage: g, Positions: [][3]float32{{1, 2, 3}, {4, 5, 6}},
			Lacets: []float32{0, math.Pi / 2}, Echelles: []float32{1, 2}},
		{Nom: "vide", Maillage: g},
	}
	ajouteDecorateurs(doc, bin, tapis, func(uint32) int { return 0 })
	if len(doc.Nodes) != 1 || len(doc.ExtUsed) != 1 || doc.ExtUsed[0] != extInstancing {
		t.Fatalf("noeuds %+v ext %v", doc.Nodes, doc.ExtUsed)
	}
	ext, ok := doc.Nodes[0].Extensions[extInstancing].(map[string]any)
	if !ok {
		t.Fatalf("extension %+v", doc.Nodes[0].Extensions)
	}
	attrs := ext["attributes"].(map[string]int)
	lit := func(nom string, n int) []float32 {
		a := doc.Accessors[attrs[nom]]
		if a.Count != 2 {
			t.Fatalf("%s : %d instances", nom, a.Count)
		}
		v := doc.BufferViews[a.BufferView]
		b := bin.aLecture(v.ByteOffset, 2*n*4)
		out := make([]float32, 2*n)
		for i := range out {
			out[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[4*i:]))
		}
		return out
	}
	if tr := lit("TRANSLATION", 3); tr[3] != 4 || tr[4] != 6 || tr[5] != -5 {
		t.Fatalf("translation %v", tr)
	}
	// A quarter turn about Halo z takes Halo x to Halo y, i.e. glTF x to glTF -z.
	q := lit("ROTATION", 4)[4:]
	x, z := rotateVec(q, [3]float64{1, 0, 0})[0], rotateVec(q, [3]float64{1, 0, 0})[2]
	if math.Abs(x) > 1e-6 || math.Abs(z+1) > 1e-6 {
		t.Fatalf("rotation %v", q)
	}
	if s := lit("SCALE", 3); s[3] != 2 || s[4] != 2 || s[5] != 2 {
		t.Fatalf("echelle %v", s)
	}
}

// rotateVec applies the unit quaternion q (x, y, z, w) to v.
func rotateVec(q []float32, v [3]float64) [3]float64 {
	qx, qy, qz, qw := float64(q[0]), float64(q[1]), float64(q[2]), float64(q[3])
	// t = 2 * cross(q.xyz, v); v' = v + w*t + cross(q.xyz, t)
	tx, ty, tz := 2*(qy*v[2]-qz*v[1]), 2*(qz*v[0]-qx*v[2]), 2*(qx*v[1]-qy*v[0])
	return [3]float64{v[0] + qw*tx + qy*tz - qz*ty, v[1] + qw*ty + qz*tx - qx*tz, v[2] + qw*tz + qx*ty - qy*tx}
}
