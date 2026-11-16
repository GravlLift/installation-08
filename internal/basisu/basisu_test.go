package basisu

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"math"
	"testing"
)

// gradient is a w x h image whose red follows x, green follows y, blue is constant and alpha is
// `a` (255: opaque).
func gradient(w, h int, a uint8) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.SetNRGBA(x, y, color.NRGBA{uint8(x * 255 / (w - 1)), uint8(y * 255 / (h - 1)), 96, a})
		}
	}
	return img
}

var ktx2ID = []byte{0xAB, 'K', 'T', 'X', ' ', '2', '0', 0xBB, '\r', '\n', 0x1A, '\n'}

func TestEncodeDecodeRoundTrip(t *testing.T) {
	src := gradient(64, 32, 255)
	for _, tc := range []struct {
		name  string
		o     Options
		model byte   // KTX2 DFD color model: 163 ETC1S, 166 UASTC
		ss    uint32 // supercompression: 1 BasisLZ, 2 Zstandard, 0 none
		tf    byte   // transfer function: 1 linear, 2 sRGB
		minDB float64
	}{
		{"etc1s srgb", Options{Codec: ETC1S, SRGB: true, Mipmaps: true}, 163, 1, 2, 30},
		{"uastc linear zstd", Options{Codec: UASTC, Mipmaps: true, ZstdLevel: 9}, 166, 2, 1, 36},
		{"uastc raw", Options{Codec: UASTC}, 166, 0, 1, 36},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data, err := Encode(src, tc.o)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.HasPrefix(data, ktx2ID) {
				t.Fatalf("not a KTX2 file: % x", data[:12])
			}
			le := binary.LittleEndian
			if vk := le.Uint32(data[12:]); vk != 0 {
				t.Errorf("vkFormat %d, want 0 (Basis)", vk)
			}
			if w, h := le.Uint32(data[20:]), le.Uint32(data[24:]); w != 64 || h != 32 {
				t.Errorf("size %dx%d", w, h)
			}
			levels := le.Uint32(data[40:])
			if tc.o.Mipmaps && levels != 7 || !tc.o.Mipmaps && levels != 1 {
				t.Errorf("%d levels (mipmaps %v)", levels, tc.o.Mipmaps)
			}
			if ss := le.Uint32(data[44:]); ss != tc.ss {
				t.Errorf("supercompression %d, want %d", ss, tc.ss)
			}
			dfd := le.Uint32(data[48:])
			if m, tf := data[dfd+12], data[dfd+14]; m != tc.model || tf != tc.tf {
				t.Errorf("DFD color model %d transfer %d, want %d %d", m, tf, tc.model, tc.tf)
			}
			dec, err := Decode(data, 0)
			if err != nil {
				t.Fatal(err)
			}
			if dec.Rect.Dx() != 64 || dec.Rect.Dy() != 32 {
				t.Fatalf("decoded %v", dec.Rect)
			}
			if db := psnrRGB(src, dec); db < tc.minDB {
				t.Errorf("PSNR %.1f dB, want >= %.0f", db, tc.minDB)
			}
			if tc.o.Mipmaps {
				last, err := Decode(data, int(levels)-1)
				if err != nil || last.Rect.Dx() != 1 || last.Rect.Dy() != 1 {
					t.Errorf("last level %v, %v", last, err)
				}
			}
		})
	}
}

func TestAlphaKept(t *testing.T) {
	src := gradient(16, 16, 255)
	for y := 0; y < 8; y++ {
		for x := 0; x < 16; x++ {
			src.Pix[src.PixOffset(x, y)+3] = 0
		}
	}
	for _, c := range []Codec{ETC1S, UASTC} {
		data, err := Encode(src, Options{Codec: c})
		if err != nil {
			t.Fatal(err)
		}
		dec, err := Decode(data, 0)
		if err != nil {
			t.Fatal(err)
		}
		if a0, a1 := dec.NRGBAAt(4, 2).A, dec.NRGBAAt(4, 12).A; a0 > 16 || a1 < 240 {
			t.Errorf("codec %d: alpha %d (cut) and %d (kept)", c, a0, a1)
		}
	}
}

func TestEncodeAcceptsAnyImage(t *testing.T) {
	// A gray image with a non-zero origin, the shape image/png returns for a gray PNG's sub-image.
	g := image.NewGray(image.Rect(3, 5, 11, 13))
	for i := range g.Pix {
		g.Pix[i] = uint8(i * 3)
	}
	data, err := Encode(g, Options{Codec: UASTC})
	if err != nil {
		t.Fatal(err)
	}
	dec, err := Decode(data, 0)
	if err != nil {
		t.Fatal(err)
	}
	if dec.Rect.Dx() != 8 || dec.Rect.Dy() != 8 {
		t.Fatalf("decoded %v", dec.Rect)
	}
	if v := dec.NRGBAAt(0, 0); v.R != v.G || v.G != v.B || v.A != 255 {
		t.Errorf("gray texel decoded as %v", v)
	}
}

func psnrRGB(a, b *image.NRGBA) float64 {
	var se float64
	var n int
	for i := 0; i+3 < len(a.Pix); i += 4 {
		for c := 0; c < 3; c++ {
			d := float64(a.Pix[i+c]) - float64(b.Pix[i+c])
			se += d * d
			n++
		}
	}
	if se == 0 {
		return 99
	}
	return 10 * math.Log10(255*255/(se/float64(n)))
}
