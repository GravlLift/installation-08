package texcompress

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/basisu"
)

// synthGLB builds a small GLB the way the himap writer lays one out: a geometry view read by an
// accessor, then one view per image. Images: 0 a JPEG layer color map, 1 a PNG normal map, 2 a PNG
// layer mask, 3 a PNG control map that a gradient layer also reads as its texture, 4 a PNG
// base color with a cut-out alpha. Texture i reads image i.
func synthGLB(t *testing.T) ([]byte, []byte) {
	t.Helper()
	geometry := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12} // 12 bytes, any content
	var bin []byte
	var views []any
	add := func(b []byte) int {
		views = append(views, map[string]any{"buffer": 0, "byteOffset": len(bin), "byteLength": len(b)})
		bin = append(bin, b...)
		for len(bin)%4 != 0 {
			bin = append(bin, 0)
		}
		return len(views) - 1
	}
	add(geometry)
	img := func(w, h int, f func(x, y int) color.NRGBA) *image.NRGBA {
		m := image.NewNRGBA(image.Rect(0, 0, w, h))
		for y := 0; y < h; y++ {
			for x := 0; x < w; x++ {
				m.SetNRGBA(x, y, f(x, y))
			}
		}
		return m
	}
	encPNG := func(m image.Image) []byte {
		var b bytes.Buffer
		if err := png.Encode(&b, m); err != nil {
			t.Fatal(err)
		}
		return b.Bytes()
	}
	var jb bytes.Buffer
	if err := jpeg.Encode(&jb, img(32, 32, func(x, y int) color.NRGBA { return color.NRGBA{uint8(x * 8), 128, uint8(y * 8), 255} }), &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	sources := [][]byte{
		jb.Bytes(),
		encPNG(img(32, 32, func(x, y int) color.NRGBA { return color.NRGBA{128, 128, 255, 255} })),
		encPNG(img(16, 16, func(x, y int) color.NRGBA { return color.NRGBA{uint8(x * 16), 0, uint8(y * 16), 255} })),
		encPNG(img(16, 8, func(x, y int) color.NRGBA { return color.NRGBA{200, 50, 150, 255} })),
		encPNG(img(8, 8, func(x, y int) color.NRGBA { return color.NRGBA{90, 90, 90, uint8(255 * (x / 4))} })),
	}
	var images, textures []any
	for i, s := range sources {
		mime := mimePNG
		if i == 0 {
			mime = mimeJPEG
		}
		images = append(images, map[string]any{"bufferView": add(s), "mimeType": mime})
		textures = append(textures, map[string]any{"sampler": 0, "source": i})
	}
	doc := map[string]any{
		"asset":          map[string]any{"version": "2.0"},
		"extensionsUsed": []any{"KHR_texture_transform"},
		"buffers":        []any{map[string]any{"byteLength": len(bin)}},
		"bufferViews":    views,
		"accessors":      []any{map[string]any{"bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3"}},
		"images":         images,
		"textures":       textures,
		"samplers":       []any{map[string]any{}},
		"materials": []any{
			map[string]any{
				"pbrMetallicRoughness": map[string]any{"baseColorTexture": map[string]any{"index": 0}},
				"extras": map[string]any{"couches": map[string]any{"masque": 2, "couches": []any{
					map[string]any{"sorte": "couleur", "texture": 0, "normale": 1, "controle": 3},
					map[string]any{"sorte": "degrade", "texture": 3, "normale": -1, "controle": 3},
				}}},
			},
			map[string]any{
				"alphaMode": "MASK", "unknownField": map[string]any{"kept": true},
				"pbrMetallicRoughness": map[string]any{"baseColorTexture": map[string]any{"index": 4}},
			},
		},
	}
	js, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	for len(js)%4 != 0 {
		js = append(js, ' ')
	}
	var out bytes.Buffer
	le := binary.LittleEndian
	w32 := func(v uint32) { _ = binary.Write(&out, le, v) }
	w32(glbMagic)
	w32(2)
	w32(uint32(12 + 8 + len(js) + 8 + len(bin)))
	w32(uint32(len(js)))
	w32(glbChunkJSON)
	out.Write(js)
	w32(uint32(len(bin)))
	w32(glbChunkBIN)
	out.Write(bin)
	return out.Bytes(), geometry
}

// parsed is a GLB read back: its document (plain JSON numbers) and binary chunk.
type parsed struct {
	doc map[string]any
	bin []byte
}

func parse(t *testing.T, glb []byte) parsed {
	t.Helper()
	le := binary.LittleEndian
	if le.Uint32(glb) != glbMagic || int(le.Uint32(glb[8:])) != len(glb) {
		t.Fatalf("bad GLB header (length %d, file %d)", le.Uint32(glb[8:]), len(glb))
	}
	lj := int(le.Uint32(glb[12:]))
	var p parsed
	if err := json.Unmarshal(glb[20:20+lj], &p.doc); err != nil {
		t.Fatal(err)
	}
	o := 20 + lj
	lb := int(le.Uint32(glb[o:]))
	if le.Uint32(glb[o+4:]) != glbChunkBIN || o+8+lb != len(glb) {
		t.Fatal("bad binary chunk")
	}
	p.bin = glb[o+8:]
	return p
}

func (p parsed) view(t *testing.T, i int) []byte {
	t.Helper()
	v := p.doc["bufferViews"].([]any)[i].(map[string]any)
	off, n := int(v["byteOffset"].(float64)), int(v["byteLength"].(float64))
	if off%4 != 0 || off+n > len(p.bin) {
		t.Fatalf("view %d at %d+%d (bin %d)", i, off, n, len(p.bin))
	}
	return p.bin[off : off+n]
}

func TestCompressGLB(t *testing.T) {
	in, geometry := synthGLB(t)
	out, st, err := CompressGLB(context.Background(), in, Options{Workers: 2})
	if err != nil {
		t.Fatal(err)
	}
	if st.Encoded != 5 || st.Kept != 0 {
		t.Fatalf("encoded %d kept %d", st.Encoded, st.Kept)
	}
	if st.ByClass[ClassColor].Images != 2 || st.ByClass[ClassNormal].Images != 1 || st.ByClass[ClassData].Images != 2 {
		t.Errorf("classes: color %+v normal %+v data %+v", st.ByClass[ClassColor], st.ByClass[ClassNormal], st.ByClass[ClassData])
	}
	if st.GPUBlock*4 > st.GPURGBA8+st.GPURGBA8/4 || st.GPUBlock == 0 {
		t.Errorf("GPU memory: RGBA8 %d, blocks %d", st.GPURGBA8, st.GPUBlock)
	}
	p := parse(t, out)
	if !bytes.Equal(p.view(t, 0), geometry) {
		t.Error("geometry view changed")
	}
	for _, key := range []string{"extensionsUsed", "extensionsRequired"} {
		list, _ := p.doc[key].([]any)
		if slices.Index(list, any(extBasisu)) < 0 || len(slices.DeleteFunc(slices.Clone(list), func(e any) bool { return e != extBasisu })) != 1 {
			t.Errorf("%s = %v", key, list)
		}
	}
	if used := p.doc["extensionsUsed"].([]any); used[0] != "KHR_texture_transform" {
		t.Errorf("existing extensions lost: %v", used)
	}
	mat := p.doc["materials"].([]any)[1].(map[string]any)
	if mat["unknownField"] == nil {
		t.Error("unknown material field dropped")
	}
	// Transfer function by class: 2 (sRGB) for the color map and the cut-out base color, 1
	// (linear) for the normal, mask and control maps.
	wantTF := []byte{2, 1, 1, 1, 2}
	sizes := [][2]int{{32, 32}, {32, 32}, {16, 16}, {16, 8}, {8, 8}}
	for i, tv := range p.doc["textures"].([]any) {
		tex := tv.(map[string]any)
		if _, ok := tex["source"]; ok {
			t.Errorf("texture %d keeps a source", i)
		}
		b := tex["extensions"].(map[string]any)[extBasisu].(map[string]any)
		if int(b["source"].(float64)) != i {
			t.Errorf("texture %d: basisu source %v", i, b["source"])
		}
		im := p.doc["images"].([]any)[i].(map[string]any)
		if im["mimeType"] != MimeKTX2 {
			t.Errorf("image %d mime %v", i, im["mimeType"])
		}
		data := p.view(t, int(im["bufferView"].(float64)))
		le := binary.LittleEndian
		if !bytes.HasPrefix(data, []byte{0xAB, 'K', 'T', 'X', ' ', '2', '0', 0xBB}) {
			t.Fatalf("image %d is not KTX2", i)
		}
		if w, h := int(le.Uint32(data[20:])), int(le.Uint32(data[24:])); w != sizes[i][0] || h != sizes[i][1] {
			t.Errorf("image %d: %dx%d", i, w, h)
		}
		if levels := le.Uint32(data[40:]); levels < 4 {
			t.Errorf("image %d: %d mip levels", i, levels)
		}
		dfd := le.Uint32(data[48:])
		if tf := data[dfd+14]; tf != wantTF[i] {
			t.Errorf("image %d: transfer function %d, want %d", i, tf, wantTF[i])
		}
		if model := data[dfd+12]; model != 166 {
			t.Errorf("image %d: color model %d, want 166 (UASTC)", i, model)
		}
		if ss := le.Uint32(data[44:]); ss != 2 {
			t.Errorf("image %d: supercompression %d, want 2 (Zstandard)", i, ss)
		}
	}
	// The cut-out base color keeps its alpha, in the same rows (no flip).
	cut := p.view(t, int(p.doc["images"].([]any)[4].(map[string]any)["bufferView"].(float64)))
	dec, err := basisu.Decode(cut, 0)
	if err != nil {
		t.Fatal(err)
	}
	if a, b := dec.NRGBAAt(1, 3).A, dec.NRGBAAt(6, 3).A; a > 16 || b < 240 {
		t.Errorf("cut-out alpha %d / %d", a, b)
	}
	// The mask's gradient is in its original orientation and channels.
	mask := p.view(t, int(p.doc["images"].([]any)[2].(map[string]any)["bufferView"].(float64)))
	if dec, err = basisu.Decode(mask, 0); err != nil {
		t.Fatal(err)
	}
	if c := dec.NRGBAAt(15, 0); c.R < 220 || c.B > 30 {
		t.Errorf("mask texel (15, 0) = %v, want red high, blue low", c)
	}
	if c := dec.NRGBAAt(0, 15); c.B < 220 || c.R > 30 {
		t.Errorf("mask texel (0, 15) = %v, want blue high, red low", c)
	}

	// Idempotent: a second pass finds nothing to do and copies the file.
	again, st2, err := CompressGLB(context.Background(), out, Options{})
	if err != nil {
		t.Fatal(err)
	}
	if st2.Encoded != 0 || st2.Kept != 5 || !bytes.Equal(again, out) {
		t.Errorf("second pass: encoded %d kept %d, identical %v", st2.Encoded, st2.Kept, bytes.Equal(again, out))
	}
}

func TestClassify(t *testing.T) {
	in, _ := synthGLB(t)
	g, err := openGLB(bytes.NewReader(in), int64(len(in)))
	if err != nil {
		t.Fatal(err)
	}
	got := classify(g.doc)
	want := []Class{ClassColor, ClassNormal, ClassData, ClassData, ClassColor}
	if !slices.Equal(got, want) {
		t.Errorf("classes %v, want %v", got, want)
	}
	// A color map also read as a normal is a normal map; an unreferenced PNG is data and an
	// unreferenced JPEG color.
	doc := map[string]any{
		"images":   []any{map[string]any{"mimeType": mimePNG}, map[string]any{"mimeType": mimePNG}, map[string]any{"mimeType": mimeJPEG}},
		"textures": []any{map[string]any{"source": json.Number("0")}},
		"materials": []any{map[string]any{
			"pbrMetallicRoughness": map[string]any{"baseColorTexture": map[string]any{"index": json.Number("0")}},
			"normalTexture":        map[string]any{"index": json.Number("0")},
		}},
	}
	if got := classify(doc); !slices.Equal(got, []Class{ClassNormal, ClassData, ClassColor}) {
		t.Errorf("classes %v", got)
	}
}

func TestCompressFileInPlace(t *testing.T) {
	in, _ := synthGLB(t)
	path := filepath.Join(t.TempDir(), "map.glb")
	if err := os.WriteFile(path, in, 0o644); err != nil {
		t.Fatal(err)
	}
	st, err := CompressFile(context.Background(), path, path, Options{Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	out, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(out)) != st.BytesOut || st.Encoded != 5 {
		t.Errorf("file %d bytes, stats %+v", len(out), st)
	}
	parse(t, out)
	if left, _ := filepath.Glob(filepath.Join(filepath.Dir(path), "*")); len(left) != 1 {
		t.Errorf("files left beside the GLB: %v", left)
	}
}

func TestCompressRejectsNonGLB(t *testing.T) {
	if _, _, err := CompressGLB(context.Background(), []byte("not a glb at all, really"), Options{}); err == nil {
		t.Error("garbage accepted")
	}
}

func TestParseFormat(t *testing.T) {
	for s, want := range map[string]Format{"": DefaultFormat, "png": FormatPNG, "ktx2": FormatKTX2} {
		if f, ok := ParseFormat(s); !ok || f != want {
			t.Errorf("ParseFormat(%q) = %v, %v", s, f, ok)
		}
	}
	if _, ok := ParseFormat("webp"); ok {
		t.Error("webp accepted")
	}
}

func TestGPUSizes(t *testing.T) {
	// 4x4: 64 + 16 + 4 texels of RGBA8; blocks: one 16-byte block per level (3 levels).
	if n := gpuRGBA8(4, 4); n != (16+4+1)*4 {
		t.Errorf("gpuRGBA8(4,4) = %d", n)
	}
	if n := gpuBlocks(4, 4); n != 3*16 {
		t.Errorf("gpuBlocks(4,4) = %d", n)
	}
	// 1024 down to 4: one byte per texel (1,398,096); 2x2 and 1x1: one block each.
	if n := gpuBlocks(1024, 1024); n != 1398096+2*16 {
		t.Errorf("gpuBlocks(1024,1024) = %d", n)
	}
}
