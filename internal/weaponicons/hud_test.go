// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import (
	"encoding/binary"
	"testing"
)

// ucshTag builds a minimal `ucsh` tag: a 0x50-byte header with HeaderSize=0x50 and
// DataSize=0 (so mip 0 sits at offset 0x50), then the given payload bytes after it.
func ucshTag(payload []byte) []byte {
	tag := make([]byte, 0x50+len(payload))
	binary.LittleEndian.PutUint32(tag[0:], 0x68736375) // 'ucsh'
	binary.LittleEndian.PutUint32(tag[0x38:], 0x50)    // HeaderSize
	binary.LittleEndian.PutUint32(tag[0x3c:], 0)       // DataSize
	copy(tag[0x50:], payload)
	return tag
}

func TestInlineBC7Image(t *testing.T) {
	// One 16-byte BC7 block (mode 6) for a 4x4 image, at HeaderSize + DataSize = 0x50.
	block := make([]byte, 16)
	block[0] = 0x04 // mode 6
	img, err := inlineBC7Image(ucshTag(block), 4, 4)
	if err != nil {
		t.Fatalf("inlineBC7Image = %v", err)
	}
	if got := img.Bounds().Dx(); got != 4 {
		t.Errorf("width = %d, want 4", got)
	}
	if got := img.Bounds().Dy(); got != 4 {
		t.Errorf("height = %d, want 4", got)
	}
}

func TestInlineBC7ImageTooShort(t *testing.T) {
	// A tag too short for mip 0: only 8 of the 16 bytes a 4x4 block needs.
	if _, err := inlineBC7Image(ucshTag(make([]byte, 8)), 4, 4); err == nil {
		t.Fatal("expected an error for a tag too short for mip 0")
	}
}

func TestInlineBC7ImageNotUCSH(t *testing.T) {
	// A tag that is not `ucsh` is refused.
	tag := make([]byte, 0x50+16)
	binary.LittleEndian.PutUint32(tag[0x38:], 0x50) // HeaderSize
	binary.LittleEndian.PutUint32(tag[0x3c:], 0)    // DataSize
	if _, err := inlineBC7Image(tag, 4, 4); err == nil {
		t.Fatal("expected an error for a non-ucsh tag")
	}
}

func TestBGRAToNRGBA(t *testing.T) {
	// A 2x1 payload: pixel 0 is B,G,R,A = 10,20,30,40; pixel 1 is 50,60,70,80.
	payload := []byte{10, 20, 30, 40, 50, 60, 70, 80}
	img, err := bgraToNRGBA(payload, 2, 1)
	if err != nil {
		t.Fatalf("bgraToNRGBA = %v", err)
	}
	if got := img.Bounds(); got.Dx() != 2 || got.Dy() != 1 {
		t.Errorf("bounds = %v, want 2x1", got)
	}
	want0 := [4]uint8{30, 20, 10, 40}
	want1 := [4]uint8{70, 60, 50, 80}
	got0 := [4]uint8{img.Pix[0], img.Pix[1], img.Pix[2], img.Pix[3]}
	got1 := [4]uint8{img.Pix[4], img.Pix[5], img.Pix[6], img.Pix[7]}
	if got0 != want0 {
		t.Errorf("pixel 0 = %v, want %v", got0, want0)
	}
	if got1 != want1 {
		t.Errorf("pixel 1 = %v, want %v", got1, want1)
	}
}

func TestBGRAToNRABadLength(t *testing.T) {
	// A 2x1 image wants exactly 8 bytes; both 7 and 9 are refused.
	for _, n := range []int{7, 9} {
		if _, err := bgraToNRGBA(make([]byte, n), 2, 1); err == nil {
			t.Errorf("payload of %d bytes: expected an error, want exactly 8", n)
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
