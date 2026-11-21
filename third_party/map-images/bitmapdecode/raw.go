// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package bitmapdecode

// The uncompressed 16-bit and signed formats bcn does not read, from the DXGI format definitions
// (little-endian, R first in memory): DXGI_FORMAT_R16G16B16A16_UNORM, R16G16B16A16_SNORM,
// R8G8B8A8_SNORM, R16G16_UNORM, R16_UNORM. UNORM n bits maps v to round(v * 255 / (2^n - 1)); SNORM
// maps v (clamped to -(2^(n-1) - 1) .. 2^(n-1) - 1, as D3D reads it) linearly onto 0 .. 255, the
// mapping bcn uses for its own SNORM formats (RG8S, BC4S, BC5S).

import (
	"encoding/binary"
	"image"
)

// unorm16 maps a 16-bit UNORM value to 8 bits with nearest rounding.
func unorm16(v uint16) byte { return byte((uint32(v)*255 + 32767) / 65535) }

// snorm8 maps an 8-bit SNORM value to 0..255 exactly as bcn's u8FromSNORM (-127 -> 0, 0 -> 128,
// 127 -> 255).
func snorm8(b byte) byte {
	v := min(max(int(int8(b)), -127), 127) + 127
	return byte(v + (v+129)>>8)
}

// snorm16 maps a 16-bit SNORM value to 0..255 with nearest rounding (-32767 -> 0, 32767 -> 255).
func snorm16(v uint16) byte {
	s := min(max(int(int16(v)), -32767), 32767) + 32767
	return byte((s*255 + 32767) / 65534)
}

// eachPixel calls fn with each pixel's bytes (bpp of them) and its 4 output bytes.
func eachPixel(px []byte, w, h, bpp int, fn func(p, out []byte)) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for i := range w * h {
		fn(px[i*bpp:(i+1)*bpp], img.Pix[i*4:i*4+4])
	}
	return img
}

func decodeRGBA16(px []byte, w, h int) *image.NRGBA {
	return eachPixel(px, w, h, 8, func(p, out []byte) {
		for c := range 4 {
			out[c] = unorm16(binary.LittleEndian.Uint16(p[c*2:]))
		}
	})
}

func decodeRGBA16S(px []byte, w, h int) *image.NRGBA {
	return eachPixel(px, w, h, 8, func(p, out []byte) {
		for c := range 4 {
			out[c] = snorm16(binary.LittleEndian.Uint16(p[c*2:]))
		}
	})
}

func decodeRGBA8S(px []byte, w, h int) *image.NRGBA {
	return eachPixel(px, w, h, 4, func(p, out []byte) {
		for c := range 4 {
			out[c] = snorm8(p[c])
		}
	})
}

// decodeRG16 writes R and G, with B = 0 and A = 255, as bcn does for RG8.
func decodeRG16(px []byte, w, h int) *image.NRGBA {
	return eachPixel(px, w, h, 4, func(p, out []byte) {
		out[0], out[1] = unorm16(binary.LittleEndian.Uint16(p)), unorm16(binary.LittleEndian.Uint16(p[2:]))
		out[2], out[3] = 0, 255
	})
}

// decodeR16 is r16_unorm_rrr0: one channel, copied into R, G and B with alpha 255 (the package's
// one-channel convention, not the swizzle's 0, which would make the image invisible).
func decodeR16(px []byte, w, h int) *image.NRGBA {
	return eachPixel(px, w, h, 2, func(p, out []byte) {
		v := unorm16(binary.LittleEndian.Uint16(p))
		out[0], out[1], out[2], out[3] = v, v, v, 255
	})
}
