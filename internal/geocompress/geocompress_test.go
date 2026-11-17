package geocompress

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"math"
	"os"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/meshopt"
)

// testGLB builds a GLB with one mesh (POSITION, TEXCOORD_0, triangle indices on a `side` x `side`
// grid) drawn by a node of scale `scale`, an image view and a view read only through the scene's
// extras.
func testGLB(t *testing.T, scale float64, side int) ([]byte, []float32, []float32, []uint32) {
	t.Helper()
	var pos, uv []float32
	for y := range side {
		for x := range side {
			pos = append(pos, float32(x)*0.37+100.0001, float32(math.Sin(float64(x*y)))*3, float32(y)*0.41-250.0003)
			uv = append(uv, float32(x)/7.3, float32(y)/3.1)
		}
	}
	var idx []uint32
	for y := range side - 1 {
		for x := range side - 1 {
			a := uint32(y*side + x)
			s := uint32(side)
			idx = append(idx, a, a+1, a+s, a+1, a+s+1, a+s)
		}
	}
	var bin bytes.Buffer
	views := []any{}
	add := func(b []byte, target int) int {
		for bin.Len()%4 != 0 {
			bin.WriteByte(0)
		}
		v := map[string]any{"buffer": 0, "byteOffset": bin.Len(), "byteLength": len(b)}
		if target != 0 {
			v["target"] = target
		}
		bin.Write(b)
		views = append(views, v)
		return len(views) - 1
	}
	floats := func(f []float32) []byte {
		b := make([]byte, 4*len(f))
		for i, v := range f {
			binary.LittleEndian.PutUint32(b[i*4:], math.Float32bits(v))
		}
		return b
	}
	ib := make([]byte, 4*len(idx))
	for i, v := range idx {
		binary.LittleEndian.PutUint32(ib[i*4:], v)
	}
	vPos := add(floats(pos), 34962)
	vUV := add(floats(uv), 34962)
	vIdx := add(ib, 34963)
	vImg := add([]byte("not really a ktx2 image, kept as it is"), 0)
	vProbe := add(floats([]float32{1, 2, 3, 4}), 0)
	doc := map[string]any{
		"asset":       map[string]any{"version": "2.0", "extras": map[string]any{"buildFormat": 2, "module": "m"}},
		"scene":       0,
		"scenes":      []any{map[string]any{"nodes": []any{0}, "extras": map[string]any{"probes": map[string]any{"bufferView": vProbe}}}},
		"nodes":       []any{map[string]any{"mesh": 0, "scale": []any{scale, scale, scale}}},
		"images":      []any{map[string]any{"bufferView": vImg, "mimeType": "image/ktx2"}},
		"bufferViews": views,
		"accessors": []any{
			map[string]any{"bufferView": vPos, "componentType": 5126, "count": side * side, "type": "VEC3", "min": []any{0, 0, 0}, "max": []any{1, 1, 1}},
			map[string]any{"bufferView": vUV, "componentType": 5126, "count": side * side, "type": "VEC2"},
			map[string]any{"bufferView": vIdx, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
		},
		"meshes":  []any{map[string]any{"primitives": []any{map[string]any{"attributes": map[string]any{"POSITION": 0, "TEXCOORD_0": 1}, "indices": 2}}}},
		"buffers": []any{map[string]any{"byteLength": bin.Len()}},
	}
	return assemble(t, doc, bin.Bytes()), pos, uv, idx
}

func assemble(t *testing.T, doc map[string]any, bin []byte) []byte {
	t.Helper()
	js, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	for len(js)%4 != 0 {
		js = append(js, ' ')
	}
	for len(bin)%4 != 0 {
		bin = append(bin, 0)
	}
	var out bytes.Buffer
	w32 := func(v uint32) { _ = binary.Write(&out, binary.LittleEndian, v) }
	w32(glbMagic)
	w32(2)
	w32(uint32(12 + 8 + len(js) + 8 + len(bin)))
	w32(uint32(len(js)))
	w32(glbChunkJSON)
	out.Write(js)
	w32(uint32(len(bin)))
	w32(glbChunkBIN)
	out.Write(bin)
	return out.Bytes()
}

// parsed is a GLB split into its document and binary chunk.
type parsed struct {
	doc map[string]any
	bin []byte
}

func parse(t *testing.T, glb []byte) parsed {
	t.Helper()
	g, err := openGLB(bytes.NewReader(glb), int64(len(glb)))
	if err != nil {
		t.Fatal(err)
	}
	return parsed{doc: g.doc, bin: glb[g.binOff : g.binOff+g.binLen]}
}

// viewBytes returns a view's data as the viewer's decoder gives it: decoded when compressed.
func (p parsed) viewBytes(t *testing.T, i int) []byte {
	t.Helper()
	v := p.doc["bufferViews"].([]any)[i].(map[string]any)
	ext, _ := v["extensions"].(map[string]any)
	mo, ok := ext[Extension].(map[string]any)
	if !ok {
		off, _ := entier(v["byteOffset"])
		n, _ := entier(v["byteLength"])
		return p.bin[off : off+n]
	}
	off, _ := entier(mo["byteOffset"])
	n, _ := entier(mo["byteLength"])
	stride, _ := entier(mo["byteStride"])
	count, _ := entier(mo["count"])
	src := p.bin[off : off+n]
	var out []byte
	var err error
	switch mo["mode"] {
	case "ATTRIBUTES":
		out, err = meshopt.DecodeVertexBuffer(src, count, stride)
		if err == nil && mo["filter"] == "EXPONENTIAL" {
			meshopt.DecodeFilterExp(out, count, stride)
		}
	case "TRIANGLES":
		out, err = meshopt.DecodeIndexBuffer(src, count, stride)
	case "INDICES":
		out, err = meshopt.DecodeIndexSequence(src, count, stride)
	}
	if err != nil {
		t.Fatal(err)
	}
	return out
}

func floatsOf(b []byte) []float32 {
	f := make([]float32, len(b)/4)
	for i := range f {
		f[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[i*4:]))
	}
	return f
}

// TestCompressRoundTrip — the geometry views are encoded and decode back within their bounds
// (positions exactly, UVs at the resolution of their largest magnitude, indices exactly up to
// rotation), the image and extras-read views stay as they were, the fallback buffer and the
// extension lists are written and the build-format stamp is merged.
func TestCompressRoundTrip(t *testing.T) {
	for _, scale := range []float64{1, 8} {
		glb, pos, uv, idx := testGLB(t, scale, 40)
		out, st, err := CompressGLB(context.Background(), glb, Options{Extras: map[string]any{"buildFormat": 3}})
		if err != nil {
			t.Fatal(err)
		}
		if len(out) >= len(glb) || st.Compressed != 3 {
			t.Fatalf("scale %g: %d -> %d bytes, %d views compressed (want 3)", scale, len(glb), len(out), st.Compressed)
		}
		p := parse(t, out)
		gotPos := floatsOf(p.viewBytes(t, 0))
		for i := range pos {
			if gotPos[i] != pos[i] {
				t.Fatalf("scale %g: position %d = %v, want %v (positions are lossless)", scale, i, gotPos[i], pos[i])
			}
		}
		if _, ok := st.MaxAttributeError["POSITION"]; ok {
			t.Error("POSITION went through the filter")
		}
		gotUV := floatsOf(p.viewBytes(t, 1))
		for i := range uv {
			// Largest |uv| is below 16: 24-bit mantissas resolve 2^-19 there.
			if d := math.Abs(float64(gotUV[i]) - float64(uv[i])); d > math.Exp2(-20)*1.0001 {
				t.Fatalf("uv %d off by %g", i, d)
			}
		}
		dec := p.viewBytes(t, 2)
		if !sameTriangles(dec, idx, 4) {
			t.Error("indices changed")
		}
		if got := string(p.viewBytes(t, 3)); got != "not really a ktx2 image, kept as it is" {
			t.Errorf("image view = %q", got)
		}
		if got := floatsOf(p.viewBytes(t, 4)); len(got) != 4 || got[3] != 4 {
			t.Errorf("probe view = %v", got)
		}
		buffers := p.doc["buffers"].([]any)
		fb, _ := buffers[len(buffers)-1].(map[string]any)
		if len(buffers) != 2 || fb["extensions"].(map[string]any)[Extension].(map[string]any)["fallback"] != true {
			t.Errorf("buffers = %v", buffers)
		}
		if !listed(p.doc, "extensionsUsed") || !listed(p.doc, "extensionsRequired") {
			t.Error("extension not listed")
		}
		ex := p.doc["asset"].(map[string]any)["extras"].(map[string]any)
		if ex["buildFormat"] != json.Number("3") || ex["module"] != "m" {
			t.Errorf("extras = %v", ex)
		}
		// Idempotent: a second pass changes nothing but the extras.
		again, st2, err := CompressGLB(context.Background(), out, Options{})
		if err != nil || st2.Compressed != 0 || !bytes.Equal(parse(t, again).bin, p.bin) {
			t.Errorf("second pass: err %v, %d compressed, binary equal %v", err, st2.Compressed, err == nil && bytes.Equal(parse(t, again).bin, p.bin))
		}
	}
}

// TestViewerFixture — with IT3D_GEOCOMPRESS_FIXTURE=1, prints the compressed 6 x 6 grid GLB as
// base64: the fixture of the viewer's decoder test (meshoptGeometry3d.test.ts), whose generator
// mirrors testGLB.
func TestViewerFixture(t *testing.T) {
	if os.Getenv("IT3D_GEOCOMPRESS_FIXTURE") != "1" {
		t.Skip("IT3D_GEOCOMPRESS_FIXTURE not set")
	}
	glb, _, _, _ := testGLB(t, 1, 6)
	out, _, err := CompressGLB(context.Background(), glb, Options{})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("%d bytes from %d\n%s", len(out), len(glb), base64.StdEncoding.EncodeToString(out))
}

// TestNotGLB — bytes that are not a GLB are refused.
func TestNotGLB(t *testing.T) {
	if _, _, err := CompressGLB(context.Background(), []byte("glTF but not really"), Options{}); err == nil {
		t.Fatal("garbage accepted")
	}
}
