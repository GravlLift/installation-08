// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import (
	"image"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/bitmapdecode"
)

// rg8 is format 3 of the shared decoder table: 2 bytes per pixel, tight rows.
func rg8OrFatal(t *testing.T) bitmapdecode.Format {
	t.Helper()
	fm, ok := bitmapdecode.Lookup(3)
	if !ok {
		t.Fatal("format 3 (r8g8_unorm) not in the shared decoder table")
	}
	return fm
}

func TestDecodeMip0(t *testing.T) {
	// A zero payload decodes to a 64x64 image through the shared decoder.
	fm := rg8OrFatal(t)
	img, err := decodeMip0(make([]byte, fm.LevelSize(64, 64)), fm, 64, 64)
	if err != nil {
		t.Fatalf("decodeMip0 = %v", err)
	}
	if got := img.Bounds(); got.Dx() != 64 || got.Dy() != 64 {
		t.Errorf("bounds = %v, want 64x64", got)
	}
}

func TestDecodeMip0RejectsShortPayload(t *testing.T) {
	// A 64x64 mip 0 needs LevelSize bytes; one byte short is refused.
	fm := rg8OrFatal(t)
	if _, err := decodeMip0(make([]byte, fm.LevelSize(64, 64)-1), fm, 64, 64); err == nil {
		t.Fatal("expected an error for a payload shorter than a 64x64 mip 0")
	}
}

func TestCropNRGBALeft(t *testing.T) {
	// A 960x80 source cropped to the declared 940x80 keeps the left edge.
	src := image.NewNRGBA(image.Rect(0, 0, shieldQuadStoreW, shieldQuadH))
	got := cropNRGBALeft(src, shieldQuadW, shieldQuadH)
	if got.Bounds().Dx() != shieldQuadW || got.Bounds().Dy() != shieldQuadH {
		t.Errorf("bounds = %v, want %dx%d", got.Bounds(), shieldQuadW, shieldQuadH)
	}
}

func TestHudFileNamesIncludeShieldScreenArt(t *testing.T) {
	names := map[string]bool{}
	for _, n := range HudFileNames() {
		names[n] = true
	}
	for _, want := range []string{"ShieldGlow", "ShieldBurst", "HealthBar"} {
		if !names[want] {
			t.Errorf("HudFileNames lacks %s", want)
		}
	}
}

func TestGrenadeHUDSources(t *testing.T) {
	want := map[string]hudSource{
		"Frag":   {atlas: 0xa2dcd69e, index: 0},
		"Plasma": {atlas: 0xa2dcd69e, index: 1},
		"Dynamo": {atlas: 0xa2dcd69e, index: 3},
		"Spike":  {atlas: 0xa2dcd69e, index: 2},
	}
	for stem, source := range want {
		if got := hudSources[stem]; got != source {
			t.Errorf("%s source = %+v, want %+v", stem, got, source)
		}
	}
}

func TestReadBitmHdrNoBitmapsBlock(t *testing.T) {
	// A tag with no tag tables at all cannot yield a bitmap header.
	if _, err := readBitmHdr(make([]byte, 0x50)); err == nil {
		t.Fatal("expected an error for a tag without the bitmaps block")
	}
}
