package weapons

// library_ktx2_test.go — the KTX2 pass on weapon output: a model's GLB is written with its
// embedded PNG/JPEG textures compressed to KTX2 (Basis UASTC), the same pass the map build
// uses, so the served bytes are smaller and the GPU texture memory is lower.

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"image"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// surfaceModel is a minimal model with one hard-surface material and three source textures,
// enough to make paintModelGLB emit embedded PNG/JPEG images for the KTX2 pass to compress.
func surfaceModel() *himap.MaillageMonde {
	img := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	for i := 0; i < len(img.Pix); i += 4 {
		img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = 200, 120, 40, 255
	}
	return &himap.MaillageMonde{
		Structure: himap.GroupeMaillage{
			Sommets: []float32{0, 0, 0, 1, 0, 0, 0, 0, 1},
			UV:      [himap.NJeuxUV][]float32{{0, 0, 1, 0, 0, 1}},
			Indices: map[uint32][]uint32{0xA: {0, 1, 2}},
		},
		Materiaux:       map[uint32]himap.Materiau{0xA: {ID: 0xA, Surface: &himap.SurfaceDure{MasqueA: 1, ASG: 2, Normale: 3}}},
		TexturesCouches: map[uint32]himap.Texture{1: {Image: img}, 2: {Image: img}, 3: {Image: img}},
	}
}

// TestWriteModelGLBKtx2 — writeModelGLB runs the KTX2 pass before the write: the GLB carries
// KHR_texture_basisu, every image is image/ktx2 (the embedded PNG/JPEG are gone), and the
// binary block holds KTX2 data, not PNG/JPEG.
func TestWriteModelGLBKtx2(t *testing.T) {
	dir := t.TempDir()
	n, err := writeModelGLB(context.Background(), dir, "2b1824d5", surfaceModel(), nil, generatorWeapon, map[string]any{"weap": "2b1824d5"})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, FileOf("2b1824d5")))
	if err != nil {
		t.Fatal(err)
	}
	if int64(len(raw)) != n {
		t.Fatalf("reported %d bytes, file has %d", n, len(raw))
	}

	// The JSON chunk: the extension is used and every image is KTX2.
	lj := int(binary.LittleEndian.Uint32(raw[12:]))
	var doc struct {
		ExtensionsUsed []string `json:"extensionsUsed"`
		Images         []struct {
			MimeType string `json:"mimeType"`
		} `json:"images"`
	}
	if err := json.Unmarshal(bytes.TrimRight(raw[20:20+lj], " "), &doc); err != nil {
		t.Fatal(err)
	}
	basisu := false
	for _, e := range doc.ExtensionsUsed {
		if e == "KHR_texture_basisu" {
			basisu = true
		}
	}
	if !basisu {
		t.Fatalf("KHR_texture_basisu not in extensionsUsed: %v", doc.ExtensionsUsed)
	}
	if len(doc.Images) == 0 {
		t.Fatal("no image in the GLB")
	}
	for i, im := range doc.Images {
		if im.MimeType != "image/ktx2" {
			t.Fatalf("image %d mime = %q, want image/ktx2", i, im.MimeType)
		}
	}

	// The binary chunk: KTX2 magic, no PNG or JPEG signature left.
	bin := raw[20+lj+8:]
	if !bytes.Contains(bin, []byte{0xAB, 'K', 'T', 'X', ' ', '2', '0', 0xBB}) {
		t.Fatal("no KTX2 magic in the binary block")
	}
	for _, sig := range [][]byte{{0x89, 'P', 'N', 'G'}, {0xFF, 0xD8, 0xFF}} {
		if bytes.Contains(bin, sig) {
			t.Fatalf("binary block still carries a %v image", sig)
		}
	}
}
