// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package bitmapdecode

// The float formats, from the DXGI format definitions (little-endian, R first in memory):
// DXGI_FORMAT_R32G32B32A32_FLOAT (IEEE 754 binary32), R16G16B16A16_FLOAT (binary16) and
// R11G11B10_FLOAT (R in bits 0-10 and G in bits 11-21, each 5 exponent bits over 6 mantissa bits;
// B in bits 22-31, 5 exponent bits over 5 mantissa bits; no sign, exponent bias 15, exponent 31 an
// infinity or a NaN, exponent 0 a denormal). Their values are linear light, tone mapped to 8 bits
// by toneMap (see the package header).

import (
	"encoding/binary"
	"image"
	"math"
)

// maxHalf is the largest finite binary16 value, the stand-in for an infinity before tone mapping.
const maxHalf = 65504

// halfToFloat converts an IEEE 754 binary16 value.
func halfToFloat(h uint16) float32 {
	return smallFloat(uint32(h>>10)&0x1f, uint32(h)&0x3ff, 10, h&0x8000 != 0)
}

// smallFloat is the value of a float with a 5-bit exponent (bias 15) and an m-bit mantissa.
func smallFloat(exp, mant uint32, m uint, neg bool) float32 {
	var v float64
	switch exp {
	case 0:
		v = math.Ldexp(float64(mant), -14-int(m))
	case 31:
		v = math.Inf(1)
		if mant != 0 {
			v = math.NaN()
		}
	default:
		v = math.Ldexp(1+float64(mant)/float64(uint32(1)<<m), int(exp)-15)
	}
	if neg {
		v = -v
	}
	return float32(v)
}

// r11g11b10 unpacks one DXGI_FORMAT_R11G11B10_FLOAT pixel.
func r11g11b10(p uint32) (r, g, b float32) {
	r = smallFloat(p>>6&0x1f, p&0x3f, 6, false)
	g = smallFloat(p>>17&0x1f, p>>11&0x3f, 6, false)
	b = smallFloat(p>>27&0x1f, p>>22&0x1f, 5, false)
	return r, g, b
}

// floatPixels reads every pixel into linear RGBA floats with fn, then tone maps them.
func floatPixels(px []byte, w, h, bpp int, fn func(p []byte, out []float32)) *image.NRGBA {
	hdr := make([]float32, w*h*4)
	for i := range w * h {
		fn(px[i*bpp:(i+1)*bpp], hdr[i*4:i*4+4])
	}
	return toneMap(hdr, w, h)
}

func decodeRGBA32F(px []byte, w, h int) *image.NRGBA {
	return floatPixels(px, w, h, 16, func(p []byte, out []float32) {
		for c := range 4 {
			out[c] = math.Float32frombits(binary.LittleEndian.Uint32(p[c*4:]))
		}
	})
}

func decodeRGBA16F(px []byte, w, h int) *image.NRGBA {
	return floatPixels(px, w, h, 8, func(p []byte, out []float32) {
		for c := range 4 {
			out[c] = halfToFloat(binary.LittleEndian.Uint16(p[c*2:]))
		}
	})
}

func decodeR11G11B10F(px []byte, w, h int) *image.NRGBA {
	return floatPixels(px, w, h, 4, func(p []byte, out []float32) {
		out[0], out[1], out[2] = r11g11b10(binary.LittleEndian.Uint32(p))
		out[3] = 1
	})
}

// sanitize makes a linear value usable: NaN and negatives read as 0, values past maxHalf (an
// infinity included) as maxHalf.
func sanitize(v float32) float64 {
	if !(v > 0) {
		return 0
	}
	return math.Min(float64(v), maxHalf)
}

// toneMap converts linear RGBA floats (4 per pixel) to an 8-bit sRGB image: per channel the
// extended Reinhard operator L(1 + L/W^2)/(1 + L), W the largest RGB value of the image (at least
// 1, so values within [0, 1] are kept), then the sRGB transfer function. Alpha is clamped to [0, 1].
func toneMap(hdr []float32, w, h int) *image.NRGBA {
	white := 1.0
	for i, v := range hdr {
		if i%4 != 3 {
			white = math.Max(white, sanitize(v))
		}
	}
	w2 := white * white
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i, v := range hdr {
		if i%4 == 3 {
			img.Pix[i] = byte(math.Round(math.Min(sanitize(v), 1) * 255))
			continue
		}
		l := sanitize(v)
		img.Pix[i] = byte(math.Round(srgb(math.Min(l*(1+l/w2)/(1+l), 1)) * 255))
	}
	return img
}

// srgb is the sRGB transfer function (IEC 61966-2-1) of a linear value in [0, 1].
func srgb(l float64) float64 {
	if l <= 0.0031308 {
		return 12.92 * l
	}
	return 1.055*math.Pow(l, 1/2.4) - 0.055
}
