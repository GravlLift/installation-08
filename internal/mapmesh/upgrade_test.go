// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package mapmesh

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/geocompress"
	"github.com/llampwall/infinite-theater-3d/internal/texcompress"
)

// geometryGLB is a GLB with one triangle-list mesh (a 20x20 grid) whose asset.extras carries
// buildFormat `format` (0: absent).
func geometryGLB(t *testing.T, format int) []byte {
	t.Helper()
	const side = 20
	var bin bytes.Buffer
	for y := range side {
		for x := range side {
			for _, v := range []float32{float32(x) * 0.5, float32(math.Sin(float64(x + y))), float32(y) * 0.5} {
				_ = binary.Write(&bin, binary.LittleEndian, math.Float32bits(v))
			}
		}
	}
	posLen := bin.Len()
	n := 0
	for y := range side - 1 {
		for x := range side - 1 {
			a := uint32(y*side + x)
			for _, i := range []uint32{a, a + 1, a + side, a + 1, a + side + 1, a + side} {
				_ = binary.Write(&bin, binary.LittleEndian, i)
				n++
			}
		}
	}
	asset := map[string]any{"version": "2.0"}
	if format > 0 {
		asset["extras"] = map[string]any{BuildFormatKey: format, "module": "m"}
	}
	js, err := json.Marshal(map[string]any{
		"asset":   asset,
		"buffers": []any{map[string]any{"byteLength": bin.Len()}},
		"bufferViews": []any{
			map[string]any{"buffer": 0, "byteOffset": 0, "byteLength": posLen},
			map[string]any{"buffer": 0, "byteOffset": posLen, "byteLength": bin.Len() - posLen},
		},
		"accessors": []any{
			map[string]any{"bufferView": 0, "componentType": 5126, "count": side * side, "type": "VEC3"},
			map[string]any{"bufferView": 1, "componentType": 5125, "count": n, "type": "SCALAR"},
		},
		"meshes": []any{map[string]any{"primitives": []any{map[string]any{"attributes": map[string]any{"POSITION": 0}, "indices": 1}}}},
		"nodes":  []any{map[string]any{"mesh": 0}},
	})
	if err != nil {
		t.Fatal(err)
	}
	for len(js)%4 != 0 {
		js = append(js, ' ')
	}
	var out bytes.Buffer
	for _, v := range []uint32{0x46546C67, 2, uint32(28 + len(js) + bin.Len()), uint32(len(js)), 0x4E4F534A} {
		_ = binary.Write(&out, binary.LittleEndian, v)
	}
	out.Write(js)
	_ = binary.Write(&out, binary.LittleEndian, uint32(bin.Len()))
	_ = binary.Write(&out, binary.LittleEndian, uint32(0x004E4942))
	out.Write(bin.Bytes())
	return out.Bytes()
}

// TestUpgradeFile — a format-2 or format-3 GLB is brought to the current format in place
// (images realigned, a format-2 file's geometry encoded, stamp updated, other extras kept); a
// current or older GLB, and a missing file, are left to the normal build (ok=false, file
// untouched).
func TestUpgradeFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "m.glb")
	if err := os.WriteFile(path, geometryGLB(t, 2), 0o644); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Stat(path)
	s, ok, err := UpgradeFile(context.Background(), path)
	if err != nil || !ok {
		t.Fatalf("format 2: ok %v, err %v", ok, err)
	}
	after, _ := os.Stat(path)
	if after.Size() >= before.Size() || s.Bytes != after.Size() || s.Triangles != 19*19*2 {
		t.Errorf("upgrade: %d -> %d bytes (reported %d), %d triangles", before.Size(), after.Size(), s.Bytes, s.Triangles)
	}
	extras, err := texcompress.AssetExtras(path)
	if err != nil || fmt.Sprint(extras[BuildFormatKey]) != fmt.Sprint(BuildFormat) || extras["module"] != "m" {
		t.Errorf("extras after upgrade = %v (%v)", extras, err)
	}
	if uses, err := geocompress.Uses(path); err != nil || !uses {
		t.Errorf("upgraded GLB does not list %s (%v)", geocompress.Extension, err)
	}
	// Format 3: its images are realigned (none here) and the stamp updated; the geometry is
	// left as the format-3 build encoded it.
	if err := os.WriteFile(path, geometryGLB(t, 3), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, ok, err := UpgradeFile(context.Background(), path); err != nil || !ok {
		t.Fatalf("format 3: ok %v, err %v", ok, err)
	}
	if extras, err := texcompress.AssetExtras(path); err != nil || fmt.Sprint(extras[BuildFormatKey]) != fmt.Sprint(BuildFormat) || extras["module"] != "m" {
		t.Errorf("format 3: extras after upgrade = %v (%v)", extras, err)
	}
	for _, format := range []int{BuildFormat, 1, 0} {
		raw := geometryGLB(t, format)
		if err := os.WriteFile(path, raw, 0o644); err != nil {
			t.Fatal(err)
		}
		if _, ok, err := UpgradeFile(context.Background(), path); ok || err != nil {
			t.Errorf("format %d: ok %v, err %v; want left to the build", format, ok, err)
		}
		if got, _ := os.ReadFile(path); !bytes.Equal(got, raw) {
			t.Errorf("format %d: file changed", format)
		}
	}
	if _, ok, _ := UpgradeFile(context.Background(), filepath.Join(dir, "absent.glb")); ok {
		t.Error("absent file reported upgraded")
	}
}
