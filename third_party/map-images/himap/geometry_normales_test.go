package himap

// LOCAL-CHANGE (infinite-theater-3d): geometry_normales.go.

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"testing"
)

// packeNormale packs (x, y, z) in [-1, 1] the way the game's slot 5 does, with the 2-bit field.
func packeNormale(x, y, z float64, haut uint32) uint32 {
	q := func(v float64) uint32 { return uint32(math.Round((v + 1) / 2 * normale10BitsMax)) }
	return q(x) | q(y)<<10 | q(z)<<20 | haut<<30
}

func presDe(t *testing.T, got [3]float32, want [3]float64, tol float64) {
	t.Helper()
	for k := 0; k < 3; k++ {
		if math.Abs(float64(got[k])-want[k]) > tol {
			t.Fatalf("got %v, want %v (tolerance %g)", got, want, tol)
		}
	}
}

func TestDecodeNormaleNormaliseLaDirection(t *testing.T) {
	// The stored vectors are directions of any length: the Spartan's spread from 0 to 1.5.
	for _, c := range []struct {
		raw  [3]float64
		haut uint32
		want [3]float64
	}{
		{[3]float64{0, 0, 1}, 1, [3]float64{0, 0, 1}},
		{[3]float64{0, 0, -0.37}, 3, [3]float64{0, 0, -1}},
		{[3]float64{0.818, -0.916, -0.638}, 1, [3]float64{0.591, -0.662, -0.461}},
		{[3]float64{-0.367, 0.003, 0.052}, 1, [3]float64{-0.990, 0.008, 0.140}},
	} {
		n := decodeNormale(packeNormale(c.raw[0], c.raw[1], c.raw[2], c.haut))
		presDe(t, n, c.want, 0.01)
		if l := math.Sqrt(float64(n[0]*n[0] + n[1]*n[1] + n[2]*n[2])); math.Abs(l-1) > 1e-5 {
			t.Fatalf("%v: length %g", n, l)
		}
	}
	// The field closest to zero is +-1/1023, never 0: the smallest vector still has a direction.
	n := decodeNormale(packeNormale(0, 0, 0, 1))
	if l := float64(n[0]*n[0] + n[1]*n[1] + n[2]*n[2]); math.IsNaN(l) || math.Abs(l-1) > 1e-5 {
		t.Fatalf("null field: %v", n)
	}
}

func TestNormalesDuTampon(t *testing.T) {
	var b bytes.Buffer
	_ = binary.Write(&b, binary.LittleEndian, []uint32{packeNormale(1, 0, 0, 1), packeNormale(0, -0.5, 0, 3)})
	got := normalesDuTampon(b.Bytes(), 2)
	if len(got) != 2 {
		t.Fatalf("%d normals", len(got))
	}
	// A zero field reads +-1/1023: off by that over the vector's length.
	presDe(t, got[0], [3]float64{1, 0, 0}, 3e-3)
	presDe(t, got[1], [3]float64{0, -1, 0}, 3e-3)
	if normalesDuTampon(b.Bytes(), 3) != nil {
		t.Fatal("a buffer shorter than its vertices must read no normal")
	}
}

// TestNormaleMondeTransposeInverse: a normal follows the inverse transpose of the placement, so it
// stays perpendicular to the placed surface under a rotation, a per-axis scale and a mirror.
func TestNormaleMondeTransposeInverse(t *testing.T) {
	tourne := PlacementScenario{Lacet: 0.7, Tangage: -0.3, Roulis: 1.1, Echelle: 1}.Instance()
	etire := tourne
	etire.Scale = [3]float64{2, 0.5, 3}
	miroir := etire
	miroir.Left = [3]float64{-tourne.Left[0], -tourne.Left[1], -tourne.Left[2]}
	// A tilted plane through the origin: two edge vectors and its normal.
	e1, e2 := [3]float64{1, 0, 1}, [3]float64{0, 1, -0.5}
	n := produitVectoriel(e1, e2)
	nl := math.Sqrt(n[0]*n[0] + n[1]*n[1] + n[2]*n[2])
	n32 := [3]float32{float32(n[0] / nl), float32(n[1] / nl), float32(n[2] / nl)}
	for nom, in := range map[string]Instance{"rotation": tourne, "scale": etire, "mirror": miroir} {
		w := in.normaleMonde(n32)
		o := in.LocalToWorld([3]float64{})
		for _, e := range [][3]float64{e1, e2} {
			p := in.LocalToWorld(e)
			d := [3]float64{p[0] - o[0], p[1] - o[1], p[2] - o[2]}
			if dot := float64(w[0])*d[0] + float64(w[1])*d[1] + float64(w[2])*d[2]; math.Abs(dot) > 1e-5 {
				t.Fatalf("%s: normal %v not perpendicular to the placed edge %v (dot %g)", nom, w, d, dot)
			}
		}
		// The normal keeps the side the placed face's winding faces (ajoute reverses a mirrored
		// face's winding).
		p1, p2 := in.LocalToWorld(e1), in.LocalToWorld(e2)
		face := produitVectoriel([3]float64{p1[0] - o[0], p1[1] - o[1], p1[2] - o[2]}, [3]float64{p2[0] - o[0], p2[1] - o[1], p2[2] - o[2]})
		if in.miroir() {
			face = [3]float64{-face[0], -face[1], -face[2]}
		}
		if dot := float64(w[0])*face[0] + float64(w[1])*face[1] + float64(w[2])*face[2]; dot <= 0 {
			t.Fatalf("%s: normal %v on the back of the placed face %v", nom, w, face)
		}
	}
}

// TestAjouteGardeLesNormalesAlignees: a group carries normals only while every mesh it holds has
// them; otherwise it carries none, never misaligned ones.
func TestAjouteGardeLesNormalesAlignees(t *testing.T) {
	in := PlacementScenario{Echelle: 1}.Instance()
	avec := &Mesh{Vertices: [][3]float64{{0, 0, 0}, {1, 0, 0}, {0, 1, 0}}, Triangles: [][3]int{{0, 1, 2}},
		Normales: [][3]float32{{0, 0, 1}, {0, 0, 1}, {0, 0, 1}}}
	sans := &Mesh{Vertices: avec.Vertices, Triangles: avec.Triangles}

	var g GroupeMaillage
	g.ajoute(avec, in, 0)
	g.ajoute(avec, in, 0)
	if len(g.Normales) != len(g.Sommets) || g.Normales[2] != 1 || g.Normales[17] != 1 {
		t.Fatalf("two meshes with normals: %d normals for %d coordinates (%v)", len(g.Normales), len(g.Sommets), g.Normales)
	}
	g.ajoute(sans, in, 0)
	g.ajoute(avec, in, 0)
	if g.Normales != nil {
		t.Fatalf("a mesh without normals must drop the group's: %d left", len(g.Normales))
	}

	var carte GroupeMaillage // a map's meshes: no normals read, none written
	carte.ajoute(sans, in, 0)
	carte.ajoute(avec, in, 0)
	if carte.Normales != nil {
		t.Fatalf("a group started without normals must keep none: %d", len(carte.Normales))
	}
}

// TestGLBPublieLesNormalesDUnObjet: an object's mesh with its normals is written with a NORMAL
// attribute in glTF axes (x, z, -y); the same mesh without them has none.
func TestGLBPublieLesNormalesDUnObjet(t *testing.T) {
	in := PlacementScenario{Echelle: 1}.Instance()
	mesh := &Mesh{Vertices: [][3]float64{{0, 0, 0}, {1, 0, 0}, {0, 1, 0}}, Triangles: [][3]int{{0, 1, 2}},
		Normales: [][3]float32{{0, 0, 1}, {0, 0, 1}, {0.6, 0, 0.8}}}
	for _, avec := range []bool{true, false} {
		m := &MaillageMonde{}
		if !avec {
			mesh = &Mesh{Vertices: mesh.Vertices, Triangles: mesh.Triangles}
		}
		m.Structure.ajoute(mesh, in, 0)
		var buf bytes.Buffer
		if err := EcritGLB(&buf, m, "test", nil); err != nil {
			t.Fatal(err)
		}
		doc, bin := litGLBTest(t, buf.Bytes())
		acc, ok := doc.Meshes[0].Primitives[0].Attributes["NORMAL"]
		if ok != avec {
			t.Fatalf("normals read %v: NORMAL present %v", avec, ok)
		}
		if !avec {
			continue
		}
		a := doc.Accessors[acc]
		v := doc.BufferViews[a.BufferView]
		var got [3][3]float32
		if err := binary.Read(bytes.NewReader(bin[v.ByteOffset:v.ByteOffset+v.ByteLength]), binary.LittleEndian, &got); err != nil {
			t.Fatal(err)
		}
		if a.Count != 3 || got[0] != [3]float32{0, 1, 0} || got[2] != [3]float32{0.6, 0.8, 0} {
			t.Fatalf("NORMAL %+v: %v, want Halo z up written as glTF y up", a, got)
		}
	}
}

// litGLBTest splits a GLB into its JSON document and its binary chunk.
func litGLBTest(t *testing.T, glb []byte) (*gltfDoc, []byte) {
	t.Helper()
	lj := binary.LittleEndian.Uint32(glb[12:])
	var doc gltfDoc
	if err := json.Unmarshal(glb[20:20+lj], &doc); err != nil {
		t.Fatal(err)
	}
	return &doc, glb[20+lj+8:]
}
