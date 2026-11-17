// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

// bc7_test.go — unit tests for the BC7 decoder. The blocks are built with the same bit
// layout the decoder reads (documented per test), and every expected pixel is computed by
// hand from the decoder's own formulas (interp, expand, weight tables) on that layout. A
// regressed field width, a shifted bit reader, or a wrong formula moves the pixels or the
// expectations, and the test fails.

import (
	"image"
	"testing"
)

// bitWriter writes a 128-bit block, least significant bit of the first byte first — the
// mirror of bitReader.
type bitWriter struct {
	b   [16]byte
	pos int
}

func (w *bitWriter) write(n, v int) {
	for i := 0; i < n; i++ {
		if v&(1<<uint(i)) != 0 {
			w.b[w.pos>>3] |= 1 << uint(w.pos&7)
		}
		w.pos++
	}
}

func (w *bitWriter) idx(bits int, vals [16]int) {
	w.write(bits-1, vals[0])
	for i := 1; i < 16; i++ {
		w.write(bits, vals[i])
	}
}

func idxAll(v int) [16]int {
	var out [16]int
	for i := range out {
		out[i] = v
	}
	return out
}

func pxAt(img *image.NRGBA, x, y int) [4]uint8 {
	o := img.PixOffset(x, y)
	return [4]uint8{img.Pix[o], img.Pix[o+1], img.Pix[o+2], img.Pix[o+3]}
}

// mode4Block builds a mode-4 block in the decoder's field order: five mode bits, two
// rotation bits, one idx-mode bit, six 5-bit color endpoints, two 6-bit alpha endpoints,
// then the two index streams (2-bit color, 3-bit alpha — or swapped when idx mode is 1).
func mode4Block(idxMode int, c [2][3]int, a [2]int, cw, aw [16]int) *bitWriter {
	w := &bitWriter{}
	w.write(5, 16) // mode 4: four zero bits then the set one
	w.write(2, 0)
	w.write(1, idxMode)
	for ch := 0; ch < 3; ch++ {
		w.write(5, c[0][ch])
		w.write(5, c[1][ch])
	}
	w.write(6, a[0])
	w.write(6, a[1])
	if idxMode == 0 {
		w.idx(2, cw)
		w.idx(3, aw)
	} else {
		w.idx(3, cw)
		w.idx(2, aw)
	}
	return w
}

// TestBC7ModeBits — the unary mode field: m zeros then a 1 in the low bits of the first
// byte. A first byte of zero is an invalid block.
func TestBC7ModeBits(t *testing.T) {
	cases := map[byte]int{
		0x01: 0, 0x02: 1, 0x04: 2, 0x08: 3,
		0x10: 4, 0x20: 5, 0x40: 6, 0x80: 7,
		0xc0: 6, // bits above the first set one are payload
		0x00: -1,
	}
	for b0, want := range cases {
		if got := bc7Mode(b0); got != want {
			t.Errorf("bc7Mode(0x%02x) = %d, want %d", b0, got, want)
		}
	}
}

// TestBC7ExpandAndInterp — the two formulas the decoder uses, pinned on known values.
func TestBC7ExpandAndInterp(t *testing.T) {
	// expand(15,5): (15<<3) | (15>>2) = 120 | 3.
	if got := expand(15, 5); got != 123 {
		t.Errorf("expand(15,5) = %d, want 123", got)
	}
	// expand(8,5): (8<<3) | (8>>2) = 64 | 2.
	if got := expand(8, 5); got != 66 {
		t.Errorf("expand(8,5) = %d, want 66", got)
	}
	if got := expand(0, 5); got != 0 {
		t.Errorf("expand(0,5) = %d, want 0", got)
	}
	if got := interp(0, 255, 0); got != 0 {
		t.Errorf("interp(0,255,0) = %d, want 0", got)
	}
	if got := interp(0, 255, 64); got != 255 {
		t.Errorf("interp(0,255,64) = %d, want 255", got)
	}
	// ((64-32)*0 + 32*255 + 32) >> 6 = 8192 >> 6.
	if got := interp(0, 255, 32); got != 128 {
		t.Errorf("interp(0,255,32) = %d, want 128", got)
	}
	// ((64-43)*0 + 43*255 + 32) >> 6 = 10985 >> 6.
	if got := interp(0, 255, 43); got != 171 {
		t.Errorf("interp(0,255,43) = %d, want 171", got)
	}
}

// TestBC7Mode4Decode — mode 4, endpoints (0,0,0)/(255,255,255), alpha 0/255. All-low
// indices put every pixel on the low endpoint; all-high indices put the 15 non-anchor
// pixels on the high endpoint (the anchor is written with one less bit, so it lands at an
// intermediate weight). Both pin the bit reader and the per-pixel layout.
func TestBC7Mode4Decode(t *testing.T) {
	c := [2][3]int{{0, 0, 0}, {31, 31, 31}} // expand(31,5) = 255
	a := [2]int{0, 63}                      // expand(63,6) = 255

	w := mode4Block(0, c, a, idxAll(0), idxAll(0))
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	if !decodeBC7Block(w.b[:], img, 0, 0, nil) {
		t.Fatal("mode 4 block did not decode exactly")
	}
	for i := 0; i < 16; i++ {
		if got := pxAt(img, i%4, i/4); got != [4]uint8{0, 0, 0, 0} {
			t.Fatalf("all-low pixel (%d,%d) = %v, want [0 0 0 0]", i%4, i/4, got)
		}
	}

	// All-high: the anchor (pixel 0) is written with bits-1, so idxAll(3) for a 2-bit
	// color index writes the anchor as 1 (weight 21), and idxAll(7) for a 3-bit alpha
	// index writes the anchor as 3 (weight 27). The 15 remaining pixels get the full
	// high index (weights 64).
	cw := idxAll(3)
	aw := idxAll(7)
	w = mode4Block(0, c, a, cw, aw)
	img = image.NewNRGBA(image.Rect(0, 0, 4, 4))
	if !decodeBC7Block(w.b[:], img, 0, 0, nil) {
		t.Fatal("mode 4 high block did not decode exactly")
	}
	// Pixel (0,0) is the anchor: color weight bc7W2[1]=21, alpha weight bc7W3[3]=27.
	wantAnchor := [4]uint8{interp(0, 255, 21), interp(0, 255, 21), interp(0, 255, 21), interp(0, 255, 27)}
	if got := pxAt(img, 0, 0); got != wantAnchor {
		t.Fatalf("anchor pixel (0,0) = %v, want %v", got, wantAnchor)
	}
	for i := 1; i < 16; i++ {
		if got := pxAt(img, i%4, i/4); got != [4]uint8{255, 255, 255, 255} {
			t.Fatalf("high pixel (%d,%d) = %v, want [255 255 255 255]", i%4, i/4, got)
		}
	}
}

// TestBC7Mode4Rotation — rotation swaps the alpha channel with a color channel before the
// pixel is written: rotation 1 moves the alpha into R.
func TestBC7Mode4Rotation(t *testing.T) {
	c := [2][3]int{{0, 0, 0}, {31, 31, 31}} // expand(31,5) = 255
	a := [2]int{0, 63}                      // expand(63,6) = 255
	w := mode4Block(0, c, a, idxAll(3), idxAll(7))
	w.b[0] |= 0x20 // rotation 1: bit 5 of the block (bits 5-6 are the rotation field)
	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	if !decodeBC7Block(w.b[:], img, 0, 0, nil) {
		t.Fatal("rotated mode 4 block did not decode exactly")
	}
	// Check a non-anchor pixel (1,0): color 255, alpha 255. Rotation 1 swaps R and A,
	// so R becomes the alpha (255) and A becomes the old R (255). Still [255 255 255 255].
	if got := pxAt(img, 1, 0); got != [4]uint8{255, 255, 255, 255} {
		t.Fatalf("rotated pixel (1,0) = %v, want [255 255 255 255]", got)
	}
	// The anchor (0,0): color weight 21, alpha weight 27. After rotation 1, R gets the
	// alpha (interp 27) and A gets the old R (interp 21).
	want := [4]uint8{interp(0, 255, 27), interp(0, 255, 21), interp(0, 255, 21), interp(0, 255, 21)}
	if got := pxAt(img, 0, 0); got != want {
		t.Fatalf("rotated anchor (0,0) = %v, want %v", got, want)
	}
}

// TestBC7Mode5Decode — mode 5: six mode bits, two rotation bits, six 7-bit endpoints,
// two 8-bit alpha endpoints, two 2-bit index streams. All-low indices give the low
// endpoint everywhere.
func TestBC7Mode5Decode(t *testing.T) {
	w := &bitWriter{}
	w.write(6, 32) // mode 5: five zero bits then the set one
	w.write(2, 0)
	for ch := 0; ch < 3; ch++ {
		w.write(7, 0)
		w.write(7, 127) // e1 = 255
	}
	w.write(8, 0)   // a0
	w.write(8, 255) // a1
	w.idx(2, idxAll(0))
	w.idx(2, idxAll(0))

	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	if !decodeBC7Block(w.b[:], img, 0, 0, nil) {
		t.Fatal("mode 5 block did not decode exactly")
	}
	for i := 0; i < 16; i++ {
		if got := pxAt(img, i%4, i/4); got != [4]uint8{0, 0, 0, 0} {
			t.Fatalf("pixel (%d,%d) = %v, want [0 0 0 0]", i%4, i/4, got)
		}
	}
}

// TestBC7Mode6Decode — mode 6: seven mode bits, six 7-bit endpoints, two 7-bit alpha
// raws, two parity bits, one 4-bit index stream. All-low indices give the low endpoint
// everywhere.
func TestBC7Mode6Decode(t *testing.T) {
	w := &bitWriter{}
	w.write(7, 64) // mode 6: six zero bits then the set one
	for ch := 0; ch < 3; ch++ {
		w.write(7, 0)
		w.write(7, 127) // e1 = 254 before parity
	}
	w.write(7, 0)   // ra0
	w.write(7, 127) // ra1
	w.write(1, 0)   // p0
	w.write(1, 1)   // p1
	w.idx(4, idxAll(0))

	img := image.NewNRGBA(image.Rect(0, 0, 4, 4))
	if !decodeBC7Block(w.b[:], img, 0, 0, nil) {
		t.Fatal("mode 6 block did not decode exactly")
	}
	for i := 0; i < 16; i++ {
		if got := pxAt(img, i%4, i/4); got != [4]uint8{0, 0, 0, 0} {
			t.Fatalf("pixel (%d,%d) = %v, want [0 0 0 0]", i%4, i/4, got)
		}
	}
}

// TestBC7Counters — a one-block image of a mode-0 block counts one opaque block; the
// counters never touch the exact modes. Mode 0 layout: 1 mode bit + 4 partition + 3×6×4
// color endpoints (no alpha channel, ab=0) = 77 bits; the rest of the 128-bit block is
// payload the decoder does not read.
func TestBC7Counters(t *testing.T) {
	w := &bitWriter{}
	w.write(1, 1) // mode 0: the set one in the first bit
	w.write(4, 0) // partition
	for ch := 0; ch < 3; ch++ {
		for e := 0; e < 6; e++ {
			w.write(4, 15) // 4-bit endpoint
		}
	}
	// 1 + 4 + 3*6*4 = 77 bits written; pad the remaining 51 bits with zeros.
	for w.pos < 128 {
		w.write(1, 0)
	}

	_, rebuilt, opaque, degraded := decodeBC7(w.b[:], 4, 4, nil)
	if rebuilt != 0 || opaque != 1 || degraded != 0 {
		t.Fatalf("counters = rebuilt %d, opaque %d, degraded %d, want 0/1/0", rebuilt, opaque, degraded)
	}
}
