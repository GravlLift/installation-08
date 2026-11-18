// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package texcompress

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/basisu"
)

func fill(w, h int, f func(x, y int) color.NRGBA) *image.NRGBA {
	m := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			m.SetNRGBA(x, y, f(x, y))
		}
	}
	return m
}

func TestBlockAligned(t *testing.T) {
	aligned := fill(8, 8, func(x, y int) color.NRGBA { return color.NRGBA{1, 2, 3, 4} })
	if out, ok := blockAligned(aligned); ok || out != image.Image(aligned) {
		t.Error("an 8x8 image was resampled")
	}
	// A uniform image stays uniform, alpha 0 keeps its color (a data map's channels are
	// independent), and the sides go to the next multiple of 4.
	flat := fill(6, 10, func(x, y int) color.NRGBA { return color.NRGBA{200, 17, 90, 0} })
	out, ok := blockAligned(flat)
	if !ok || out.Bounds() != image.Rect(0, 0, 8, 12) {
		t.Fatalf("6x10 -> %v (resampled %v)", out.Bounds(), ok)
	}
	n := out.(*image.NRGBA)
	for y := range 12 {
		for x := range 8 {
			if c := n.NRGBAAt(x, y); c != (color.NRGBA{200, 17, 90, 0}) {
				t.Fatalf("texel (%d, %d) = %v", x, y, c)
			}
		}
	}
	// A left-to-right ramp stays a ramp in the same direction.
	ramp := fill(5, 5, func(x, y int) color.NRGBA { return color.NRGBA{uint8(x * 60), 0, 0, 255} })
	r, _ := blockAligned(ramp)
	rn := r.(*image.NRGBA)
	if a, b := rn.NRGBAAt(2, 3).R, rn.NRGBAAt(5, 3).R; a >= b {
		t.Errorf("ramp lost its direction: %d then %d", a, b)
	}
}

// glbOf lays out a GLB from a document and its binary chunk.
func glbOf(t *testing.T, doc map[string]any, bin []byte) []byte {
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
	for _, v := range []uint32{glbMagic, 2, uint32(28 + len(js) + len(bin)), uint32(len(js)), glbChunkJSON} {
		_ = binary.Write(&out, binary.LittleEndian, v)
	}
	out.Write(js)
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(bin)))
	_ = binary.Write(&out, binary.LittleEndian, uint32(glbChunkBIN))
	out.Write(bin)
	return out.Bytes()
}

func TestCompressAlignsImages(t *testing.T) {
	var b bytes.Buffer
	if err := png.Encode(&b, fill(6, 10, func(x, y int) color.NRGBA { return color.NRGBA{uint8(x * 40), 80, 160, 255} })); err != nil {
		t.Fatal(err)
	}
	doc := map[string]any{
		"asset":       map[string]any{"version": "2.0"},
		"buffers":     []any{map[string]any{"byteLength": b.Len()}},
		"bufferViews": []any{map[string]any{"buffer": 0, "byteOffset": 0, "byteLength": b.Len()}},
		"images":      []any{map[string]any{"bufferView": 0, "mimeType": mimePNG}},
		"textures":    []any{map[string]any{"source": 0}},
		"materials":   []any{map[string]any{"pbrMetallicRoughness": map[string]any{"baseColorTexture": map[string]any{"index": 0}}}},
	}
	out, st, err := CompressGLB(context.Background(), glbOf(t, doc, b.Bytes()), Options{Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	if st.Encoded != 1 || st.Aligned != 1 {
		t.Errorf("encoded %d aligned %d", st.Encoded, st.Aligned)
	}
	p := parse(t, out)
	if w, h, ok := ktx2Size(p.view(t, 0)); !ok || w != 8 || h != 12 {
		t.Errorf("KTX2 %dx%d (%v), want 8x12", w, h, ok)
	}
}

// TestRealignFile — a geometry-compressed GLB (a second, data-less fallback buffer, a view on
// it) with one misaligned and one aligned KTX2 image: only the misaligned one is re-encoded and
// appended; every other view keeps its bytes and offset; the extras are merged; a second call
// with nothing to do leaves the file alone.
func TestRealignFile(t *testing.T) {
	enc := func(w, h int) []byte {
		data, err := basisu.Encode(fill(w, h, func(x, y int) color.NRGBA { return color.NRGBA{uint8(x * 30), uint8(y * 20), 99, 255} }), Preset(ClassColor))
		if err != nil {
			t.Fatal(err)
		}
		return data
	}
	geometry := []byte{9, 8, 7, 6, 5, 4, 3, 2}
	odd, even := enc(6, 10), enc(8, 8)
	var bin []byte
	var views []any
	add := func(b []byte) {
		views = append(views, map[string]any{"buffer": 0, "byteOffset": len(bin), "byteLength": len(b)})
		bin = append(bin, b...)
		for len(bin)%4 != 0 {
			bin = append(bin, 0)
		}
	}
	add(geometry)
	add(odd)
	add(even)
	views = append(views, map[string]any{"buffer": 1, "byteOffset": 0, "byteLength": 64,
		"extensions": map[string]any{"EXT_meshopt_compression": map[string]any{"buffer": 0, "byteOffset": 0, "byteLength": 8}}})
	tex := func(i int) map[string]any {
		return map[string]any{"extensions": map[string]any{extBasisu: map[string]any{"source": i}}}
	}
	doc := map[string]any{
		"asset":       map[string]any{"version": "2.0", "extras": map[string]any{"buildFormat": 3, "module": "m"}},
		"buffers":     []any{map[string]any{"byteLength": len(bin)}, map[string]any{"byteLength": 64, "extensions": map[string]any{"EXT_meshopt_compression": map[string]any{"fallback": true}}}},
		"bufferViews": views,
		"images":      []any{map[string]any{"bufferView": 1, "mimeType": MimeKTX2}, map[string]any{"bufferView": 2, "mimeType": MimeKTX2}},
		"textures":    []any{tex(0), tex(1)},
		"materials":   []any{map[string]any{"pbrMetallicRoughness": map[string]any{"baseColorTexture": map[string]any{"index": 0}}, "emissiveTexture": map[string]any{"index": 1}}},
	}
	path := filepath.Join(t.TempDir(), "m.glb")
	if err := os.WriteFile(path, glbOf(t, doc, bin), 0o644); err != nil {
		t.Fatal(err)
	}
	st, err := RealignFile(context.Background(), path, map[string]any{"buildFormat": 4}, Options{Workers: 1})
	if err != nil {
		t.Fatal(err)
	}
	if st.Aligned != 1 || st.Kept != 1 {
		t.Errorf("aligned %d kept %d", st.Aligned, st.Kept)
	}
	raw, _ := os.ReadFile(path)
	p := parse(t, raw)
	if !bytes.Equal(p.view(t, 0), geometry) || !bytes.Equal(p.view(t, 2), even) {
		t.Error("an untouched view changed")
	}
	vs := p.doc["bufferViews"].([]any)
	for _, i := range []int{0, 2} {
		if off := vs[i].(map[string]any)["byteOffset"].(float64); int(off) != int(views[i].(map[string]any)["byteOffset"].(int)) {
			t.Errorf("view %d moved to %v", i, off)
		}
	}
	if fb := vs[3].(map[string]any); fb["buffer"].(float64) != 1 || fb["byteLength"].(float64) != 64 {
		t.Errorf("fallback view changed: %v", fb)
	}
	moved := p.view(t, 1)
	if w, h, ok := ktx2Size(moved); !ok || w != 8 || h != 12 {
		t.Errorf("realigned image %dx%d (%v), want 8x12", w, h, ok)
	}
	if off := int(vs[1].(map[string]any)["byteOffset"].(float64)); off < len(bin) {
		t.Errorf("realigned image at %d, inside the old chunk (%d bytes)", off, len(bin))
	}
	if _, err := basisu.Decode(moved, 0); err != nil {
		t.Errorf("realigned image does not decode: %v", err)
	}
	if bl := int(p.doc["buffers"].([]any)[0].(map[string]any)["byteLength"].(float64)); bl != len(p.bin) {
		t.Errorf("buffer 0 byteLength %d, chunk %d", bl, len(p.bin))
	}
	ex := p.doc["asset"].(map[string]any)["extras"].(map[string]any)
	if ex["buildFormat"].(float64) != 4 || ex["module"] != "m" {
		t.Errorf("extras %v", ex)
	}

	st2, err := RealignFile(context.Background(), path, nil, Options{})
	if err != nil || st2.Aligned != 0 || st2.Kept != 2 {
		t.Errorf("second pass: %+v, %v", st2, err)
	}
	if again, _ := os.ReadFile(path); !bytes.Equal(again, raw) {
		t.Error("second pass rewrote the file")
	}
}
