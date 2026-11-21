// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package bitmapdecode

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"math"
	"math/rand/v2"
	"testing"

	"github.com/woozymasta/bcn"
)

// bc6hBlock writes BC6H fields LSB first, in the order of the mode's row of Microsoft's "BC6H
// Format" documentation.
type bc6hBlock struct {
	b   [16]byte
	pos int
}

func (k *bc6hBlock) put(n int, v uint32) {
	for i := range n {
		if v>>i&1 == 1 {
			k.b[k.pos/8] |= 1 << (k.pos % 8)
		}
		k.pos++
	}
}

// mode11 is a one-region block of mode 11 (mode bits 00011): endpoints of 10 bits stored as is,
// then the 16 indices (4 bits, 3 for the anchor texel 0).
func mode11(w, x [3]uint32, idx [16]uint32) [16]byte {
	var k bc6hBlock
	k.put(5, 0b00011)
	for _, v := range w {
		k.put(10, v)
	}
	for _, v := range x {
		k.put(10, v)
	}
	k.put(3, idx[0])
	for _, v := range idx[1:] {
		k.put(4, v)
	}
	return k.b
}

// The expected halves below follow the documentation's unquantize (unsigned:
// ((v << 16) + 0x8000) >> bits, 0 and the maximum mapped to 0 and 0xFFFF; signed: 0x7FFF at the
// maximum), interpolation ((a * (64 - w) + b * w + 32) >> 6 with the 4-bit weights 0, 4, 9, 13,
// 17, 21, 26, 30, ...) and finish_unquantize ((v * 31) >> 6 unsigned, >> 5 signed, sign bit apart).

func TestBC6HMode11Unsigned(t *testing.T) {
	blk := mode11([3]uint32{1023, 0, 512}, [3]uint32{0, 0, 0}, [16]uint32{7, 15})
	got, err := bcn.DecodeBC6H(blk[:], 4, 4, false)
	if err != nil {
		t.Fatal(err)
	}
	// Unquantized endpoints: R 0xFFFF (1023) and 0, G 0 and 0, B 32800 (512) and 0. Texel 0 has
	// index 7 (weight 30): R (0xFFFF * 34 + 32) >> 6 = 34815, finished 16863; texel 1 index 15 (X);
	// texel 2 index 0 (W).
	if finishU(interp(0xFFFF, 0, 30)) != 16863 {
		t.Fatal("interp arithmetic")
	}
	for texel, w := range map[int][3]uint16{
		0: {16863, 0, finishU(interp(32800, 0, 30))},
		1: {0, 0, 0},
		2: {0x7BFF, 0, 0x3E0F},
	} {
		if g := [3]uint16{got[texel*3], got[texel*3+1], got[texel*3+2]}; g != w {
			t.Errorf("texel %d: %04x, want %04x", texel, g, w)
		}
	}
	// The halves of texel 2: 65504 (the largest half), 0, 1.5146484375.
	if v := halfToFloat(got[6]); v != 65504 {
		t.Errorf("R %v", v)
	}
	if v := halfToFloat(got[8]); v != 1.5146484375 {
		t.Errorf("B %v", v)
	}
}

func interp(a, b, w int) int { return (a*(64-w) + b*w + 32) >> 6 }
func finishU(v int) uint16   { return uint16(v * 31 >> 6) }

func TestBC6HMode11Signed(t *testing.T) {
	// R +511 (the largest), G -511 (10-bit two's complement 513), B 0.
	blk := mode11([3]uint32{511, 513, 0}, [3]uint32{0, 0, 0}, [16]uint32{})
	got, err := bcn.DecodeBC6H(blk[:], 4, 4, true)
	if err != nil {
		t.Fatal(err)
	}
	if g := [3]uint16{got[0], got[1], got[2]}; g != [3]uint16{0x7BFF, 0xFBFF, 0} {
		t.Errorf("texel 0: %04x, want 7bff fbff 0000 (+65504, -65504, 0)", g)
	}
}

// TestBC6HMode12Delta checks a transformed mode: mode 12 (00111) stores W in 11 bits and X as a
// signed 9-bit delta from W (rx = W + delta mod 2^11).
func TestBC6HMode12Delta(t *testing.T) {
	var k bc6hBlock
	k.put(5, 0b00111)
	k.put(10, 0) // rw[9:0]
	k.put(10, 0) // gw[9:0]
	k.put(10, 0) // bw[9:0]
	k.put(9, 0x1ff)
	k.put(1, 1) // rx = -1, rw[10]: rw = 1024, rx = 1023
	k.put(9, 0)
	k.put(1, 0)
	k.put(9, 0)
	k.put(1, 0)
	k.put(3, 0)  // texel 0: W
	k.put(4, 15) // texel 1: X
	got, err := bcn.DecodeBC6H(k.b[:], 4, 4, false)
	if err != nil {
		t.Fatal(err)
	}
	// 1024 over 11 bits: ((1024<<16)+0x8000)>>11 = 32784 -> *31>>6 = 0x3E07; 1023: 32752 -> 0x3DF8.
	if got[0] != 0x3E07 || got[3] != 0x3DF8 || got[1] != 0 || got[4] != 0 {
		t.Errorf("texels %04x %04x, want 3e07 3df8", got[0], got[3])
	}
}

// TestBC6HLargeNotBlank is the silent blank: at a size where bcn.DecodeImage takes its parallel
// path, BC6H through Decode is the decoded image, and the bcn routing refuses BC6H with an error.
func TestBC6HLargeNotBlank(t *testing.T) {
	const side = 1024 // 65536 blocks: past bcn's parallel threshold of 256 blocks per worker
	blk := mode11([3]uint32{1023, 0, 512}, [3]uint32{1023, 0, 512}, [16]uint32{})
	data := bytes.Repeat(blk[:], side/4*side/4)
	f, _ := Lookup(47)
	img, err := f.Decode(data, side, side, Tight)
	if err != nil {
		t.Fatal(err)
	}
	want := img.Pix[:4]
	if want[0] != 255 || want[1] != 0 || want[2] == 0 || want[3] != 255 {
		t.Fatalf("pixel %v, want R 255, G 0, B > 0, A 255", want)
	}
	for i := 0; i < len(img.Pix); i += 4 {
		if !bytes.Equal(img.Pix[i:i+4], want) {
			t.Fatalf("pixel %d: %v, want %v", i/4, img.Pix[i:i+4], want)
		}
	}
	for _, bf := range []bcn.Format{bcn.FormatBC6HU, bcn.FormatBC6HS, bcn.FormatUnknown} {
		if _, err := decodeBCn(data, side, side, bf); !errors.Is(err, ErrUnsafeBCn) {
			t.Errorf("%v: %v, want ErrUnsafeBCn", bf, err)
		}
	}
	// What the guard is for: bcn itself, on the same data.
	if old, err := bcn.DecodeImage(data, side, side, bcn.FormatBC6HU); err == nil {
		t.Logf("bcn.DecodeImage(BC6HU, %dx%d): nil error, blank image %v (the dropped error)", side, side, !bytes.ContainsFunc(old.Pix, func(r rune) bool { return r != 0 }))
	}
}

// TestBCnSafeNeverRefused: every format bcnSafe lets through decodes without an error on bcn's
// serial path, where errors are returned, and its parallel path gives the same pixels: the
// parallel path has nothing to drop.
func TestBCnSafeNeverRefused(t *testing.T) {
	const side = 512
	rng := rand.New(rand.NewPCG(1, 2))
	data := make([]byte, side*side*16)
	for i := range data {
		data[i] = byte(rng.Uint32())
	}
	for bf := range bcnSafe {
		serial, err := bcn.DecodeImageWithOptions(data, side, side, bf, &bcn.DecodeOptions{Workers: 1})
		if err != nil {
			t.Errorf("%v serial: %v", bf, err)
			continue
		}
		parallel, err := decodeBCn(data, side, side, bf)
		if err != nil || !bytes.Equal(serial.Pix, parallel.Pix) {
			t.Errorf("%v parallel: %v, same pixels %v", bf, err, err == nil && bytes.Equal(serial.Pix, parallel.Pix))
		}
	}
	for v, f := range formats {
		if f.k == viaBCn && !bcnSafe[f.bc] {
			t.Errorf("format %d %s routes to bcn format %v, not in bcnSafe", v, f.Name, f.bc)
		}
	}
}

// TestEveryFormatDecodes decodes every table format at a small and a large size, tight and pitched.
func TestEveryFormatDecodes(t *testing.T) {
	for v, f := range formats {
		for _, s := range [][2]int{{8, 8}, {940, 80}} {
			for _, l := range []Layout{Tight, Pitched} {
				n := f.LevelSize(s[0], s[1])
				if l == Pitched {
					n = f.PitchedSize(s[0], s[1])
				}
				img, err := f.Decode(make([]byte, n), s[0], s[1], l)
				if err != nil {
					t.Errorf("format %d %s %dx%d layout %d: %v", v, f.Name, s[0], s[1], l, err)
				} else if img.Rect.Dx() != s[0] || img.Rect.Dy() != s[1] {
					t.Errorf("format %d: %v", v, img.Rect)
				}
			}
		}
	}
}

func TestShortData(t *testing.T) {
	f, _ := Lookup(49)
	if _, err := f.Decode(make([]byte, 75199), 940, 80, Tight); !errors.Is(err, ErrShortData) {
		t.Errorf("tight: %v", err)
	}
	// Pitched: 20 block rows of 235 blocks padded to 3840 bytes; the last row needs 3760.
	if _, err := f.Decode(make([]byte, 19*3840+3759), 940, 80, Pitched); !errors.Is(err, ErrShortData) {
		t.Errorf("pitched: %v", err)
	}
	if _, err := f.Decode(make([]byte, 19*3840+3760), 940, 80, Pitched); err != nil {
		t.Errorf("pitched, last row unpadded: %v", err)
	}
	if _, err := f.Decode(nil, 0, 4, Tight); !errors.Is(err, ErrDimensions) {
		t.Errorf("dimensions: %v", err)
	}
}

func TestSizes(t *testing.T) {
	bc1, bc7, bgra := formats[14], formats[49], formats[11]
	if bc1.LevelSize(1024, 512) != 262144 || bc7.LevelSize(2, 1) != 16 || bgra.LevelSize(3, 2) != 24 {
		t.Errorf("tight sizes %d %d %d", bc1.LevelSize(1024, 512), bc7.LevelSize(2, 1), bgra.LevelSize(3, 2))
	}
	// The measured resources: 940x80 BC7 holds 76800, 5040x2160 BC7 10920960, 288x52 BGRA8 66560.
	if bc7.PitchedSize(940, 80) != 76800 || bc7.PitchedSize(5040, 2160) != 10920960 || bgra.PitchedSize(288, 52) != 66560 {
		t.Errorf("pitched sizes %d %d %d", bc7.PitchedSize(940, 80), bc7.PitchedSize(5040, 2160), bgra.PitchedSize(288, 52))
	}
	if bc7.ResourceLayout(76800, 940, 80) != Pitched || bc7.ResourceLayout(75200, 940, 80) != Tight || bgra.ResourceLayout(4096, 32, 32) != Tight {
		t.Error("ResourceLayout")
	}
}

// TestPitchedRows: a 3x2 BGRA8 level with rows padded to 256 bytes decodes as its tight twin.
func TestPitchedRows(t *testing.T) {
	f, _ := Lookup(11)
	tight := []byte{1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24}
	pitched := make([]byte, 256+12)
	copy(pitched, tight[:12])
	copy(pitched[256:], tight[12:])
	for i := 12; i < 256; i++ {
		pitched[i] = 0xEE
	}
	a, err1 := f.Decode(tight, 3, 2, Tight)
	b, err2 := f.Decode(pitched, 3, 2, Pitched)
	if err1 != nil || err2 != nil || !bytes.Equal(a.Pix, b.Pix) {
		t.Fatalf("%v %v\n%v\n%v", err1, err2, a, b)
	}
	if a.Pix[0] != 3 || a.Pix[2] != 1 {
		t.Errorf("BGRA order: %v", a.Pix[:4])
	}
}

func pixel(t *testing.T, v int, px []byte, w, h int) *image.NRGBA {
	t.Helper()
	f, ok := Lookup(v)
	if !ok {
		t.Fatalf("format %d not in the table", v)
	}
	img, err := f.Decode(px, w, h, Tight)
	if err != nil {
		t.Fatal(err)
	}
	return img
}

func u16s(vs ...uint16) []byte {
	b := make([]byte, 0, 2*len(vs))
	for _, v := range vs {
		b = binary.LittleEndian.AppendUint16(b, v)
	}
	return b
}

func u32s(vs ...uint32) []byte {
	b := make([]byte, 0, 4*len(vs))
	for _, v := range vs {
		b = binary.LittleEndian.AppendUint32(b, v)
	}
	return b
}

func wantPix(t *testing.T, name string, img *image.NRGBA, want ...byte) {
	t.Helper()
	if !bytes.Equal(img.Pix, want) {
		t.Errorf("%s: %v, want %v", name, img.Pix, want)
	}
}

func TestUNORMSNORM(t *testing.T) {
	// r16g16b16a16_unorm: 0xFFFF, 0, 0x8000, 0x0101 -> 255, 0, 128, 1.
	wantPix(t, "rgba16", pixel(t, 30, u16s(0xFFFF, 0, 0x8000, 0x0101), 1, 1), 255, 0, 128, 1)
	// r16g16_unorm: R, G; B 0, A 255.
	wantPix(t, "rg16", pixel(t, 33, u16s(0xFFFF, 0x8000), 1, 1), 255, 128, 0, 255)
	// r16_unorm_rrr0: one channel into R, G, B, alpha 255; two pixels.
	wantPix(t, "r16", pixel(t, 32, u16s(0xFFFF, 0), 2, 1), 255, 255, 255, 255, 0, 0, 0, 255)
	// r8g8b8a8_snorm: 127 -> 255, -127 -> 0, -128 -> 0 (clamped), 0 -> 128.
	wantPix(t, "rgba8s", pixel(t, 28, []byte{0x7F, 0x81, 0x80, 0x00}, 1, 1), 255, 0, 0, 128)
	// r16g16b16a16_snorm: 32767 -> 255, -32767 -> 0, -32768 -> 0, 0 -> 128.
	wantPix(t, "rgba16s", pixel(t, 34, u16s(0x7FFF, 0x8001, 0x8000, 0), 1, 1), 255, 0, 0, 128)
	// r10g10b10a2_unorm: R 1023 (bits 0-9), G 0, B 512 (bits 20-29), A 3 (bits 30-31).
	wantPix(t, "rgb10a2", pixel(t, 29, u32s(1023|512<<20|3<<30), 1, 1), 255, 0, 128, 255)
	if f, _ := Lookup(32); !f.Mono() {
		t.Error("r16_unorm_rrr0 not mono")
	}
}

func TestFloats(t *testing.T) {
	// Within [0, 1] the tone map is the identity, then sRGB: 1 -> 255, 0.5 -> 188, 0 -> 0.
	half := func(f float32) uint16 { // exact for these values
		switch f {
		case 1:
			return 0x3C00
		case 0.5:
			return 0x3800
		}
		return 0
	}
	wantPix(t, "rgba16f", pixel(t, 25, u16s(half(1), half(0.5), half(0), half(0.5)), 1, 1), 255, 188, 0, 128)
	f32 := func(f float32) uint32 { return math.Float32bits(f) }
	wantPix(t, "rgba32f", pixel(t, 24, u32s(f32(1), f32(0.5), f32(-3), f32(2)), 1, 1), 255, 188, 0, 255)
	// r11g11b10_float: R 1.0 (exp 15 << 6), G 2.0 (exp 16 << 6), B 0.5 (exp 14 << 5). White 2:
	// 2 -> 1 -> 255; 1 -> 1.25/2 = 0.625 -> sRGB 207; 0.5 -> 0.5*(1+0.125)/1.5 = 0.375 -> 165.
	p := uint32(15<<6) | uint32(16<<6)<<11 | uint32(14<<5)<<22
	r, g, b := r11g11b10(p)
	if r != 1 || g != 2 || b != 0.5 {
		t.Errorf("r11g11b10 %v %v %v", r, g, b)
	}
	exp := func(l float64) byte { return byte(math.Round(srgb(l) * 255)) }
	wantPix(t, "r11g11b10", pixel(t, 51, u32s(p), 1, 1), exp(0.625), 255, exp(0.375), 255)
	if exp(0.625) != 207 || exp(0.375) != 165 || exp(0.5) != 188 {
		t.Errorf("sRGB points %d %d %d", exp(0.625), exp(0.375), exp(0.5))
	}
	// Denormals and specials.
	if v := halfToFloat(0x0001); v != float32(math.Ldexp(1, -24)) {
		t.Errorf("half denormal %v", v)
	}
	if v := halfToFloat(0xC000); v != -2 {
		t.Errorf("half -2: %v", v)
	}
	if r, _, _ := r11g11b10(32); r != float32(math.Ldexp(32, -20)) {
		t.Errorf("r11 denormal %v", r)
	}
	if !math.IsInf(float64(halfToFloat(0x7C00)), 1) || !math.IsNaN(float64(halfToFloat(0x7E00))) {
		t.Error("half inf / NaN")
	}
	// NaN and +Inf: NaN reads 0, +Inf the largest half (then the white point, 255).
	wantPix(t, "specials", pixel(t, 25, u16s(0x7E00, 0x7C00, 0, 0x3C00), 1, 1), 0, 255, 0, 255)
}
