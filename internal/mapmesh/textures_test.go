package mapmesh

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/texcompress"
)

// oneImageGLB is a GLB holding a single 8x8 PNG image read by one texture.
func oneImageGLB(t *testing.T) []byte {
	t.Helper()
	var pb bytes.Buffer
	if err := png.Encode(&pb, image.NewNRGBA(image.Rect(0, 0, 8, 8))); err != nil {
		t.Fatal(err)
	}
	bin := pb.Bytes()
	for len(bin)%4 != 0 {
		bin = append(bin, 0)
	}
	js, err := json.Marshal(map[string]any{
		"asset":       map[string]any{"version": "2.0"},
		"buffers":     []any{map[string]any{"byteLength": len(bin)}},
		"bufferViews": []any{map[string]any{"buffer": 0, "byteOffset": 0, "byteLength": pb.Len()}},
		"images":      []any{map[string]any{"bufferView": 0, "mimeType": "image/png"}},
		"textures":    []any{map[string]any{"source": 0}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for len(js)%4 != 0 {
		js = append(js, ' ')
	}
	var out bytes.Buffer
	for _, v := range []uint32{0x46546C67, 2, uint32(28 + len(js) + len(bin)), uint32(len(js)), 0x4E4F534A} {
		_ = binary.Write(&out, binary.LittleEndian, v)
	}
	out.Write(js)
	_ = binary.Write(&out, binary.LittleEndian, uint32(len(bin)))
	_ = binary.Write(&out, binary.LittleEndian, uint32(0x004E4942))
	out.Write(bin)
	return out.Bytes()
}

// TestWriteGLBTextures: a KTX2 build announces the texture step and leaves only the finished
// GLB at `path`, its image in KTX2; a PNG build writes the writer's bytes unchanged.
func TestWriteGLBTextures(t *testing.T) {
	src := oneImageGLB(t)
	write := func(w io.Writer) error { _, err := w.Write(src); return err }
	dir := t.TempDir()

	pngPath := filepath.Join(dir, "png.glb")
	if _, err := writeGLB(context.Background(), pngPath, "k", texcompress.FormatPNG, nil, write); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(pngPath); !bytes.Equal(got, src) {
		t.Error("PNG build changed the writer's bytes")
	}

	ktxPath := filepath.Join(dir, "ktx2.glb")
	var steps []Step
	n, err := writeGLB(context.Background(), ktxPath, "k", texcompress.FormatKTX2, func(s Step) { steps = append(steps, s) }, write)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(ktxPath)
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(got)) != n || !bytes.Contains(got, []byte(texcompress.MimeKTX2)) || !bytes.Contains(got, []byte("KHR_texture_basisu")) {
		t.Errorf("KTX2 build: %d bytes (reported %d), KTX2 image %v", len(got), n, bytes.Contains(got, []byte(texcompress.MimeKTX2)))
	}
	if len(steps) != 1 || steps[0] != StepTextures {
		t.Errorf("steps %v, want [%s]", steps, StepTextures)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 2 {
		var names []string
		for _, e := range entries {
			names = append(names, e.Name())
		}
		t.Errorf("files left: %v", names)
	}
}
