// bc7.go — BC7 (BPTC) DECODER.
//
// SCOPE, AND WHY IT IS WHAT IT IS. Modes 4, 5 and 6 (single subset) decode EXACTLY: they
// need no partition table. They represent 99% of the blocks measured on these icons.
//
// Mode 7 is RECONSTRUCTED (bc7_mode7.go): it is the only multi-subset mode that degraded
// the deliverable, since modes 0 to 3 have no alpha channel — their alpha is 255
// everywhere and the fallback renders it exactly, and only the alpha is kept in the glyph.
//
// The partition tables are deliberately NOT copied here: a wrong table would render a
// plausible but false image, and that is the worst case. What is missing is recovered by
// fitting to the lower mip level.
//
// Reference: the D3D11 BC7 (BPTC) specification. The interpolation weights and the field
// widths are the standard's; nothing is guessed.

package weaponicons

import "image"

// interpolation weights by index bit count.
var bc7W2 = [4]int{0, 21, 43, 64}
var bc7W3 = [8]int{0, 9, 18, 27, 37, 46, 55, 64}
var bc7W4 = [16]int{0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64}

// bc7Mode: a block's mode is encoded in UNARY in the low bits of the first byte — m zeros
// followed by a 1. Returns -1 for an invalid block (low 8 bits zero).
func bc7Mode(b0 byte) int {
	for m := 0; m < 8; m++ {
		if b0&(1<<uint(m)) != 0 {
			return m
		}
	}
	return -1
}

// bitReader reads a 128-bit block, least significant bit of the first byte first.
type bitReader struct {
	b   []byte
	pos int
}

func (r *bitReader) read(n int) int {
	v := 0
	for i := 0; i < n; i++ {
		byteIdx := r.pos >> 3
		if byteIdx >= len(r.b) {
			r.pos++
			continue
		}
		bit := (r.b[byteIdx] >> uint(r.pos&7)) & 1
		v |= int(bit) << uint(i)
		r.pos++
	}
	return v
}

// interp: ((64-w)*e0 + w*e1 + 32) >> 6, the standard's formula.
func interp(e0, e1, w int) uint8 {
	return uint8((((64-w)*e0 + w*e1 + 32) >> 6) & 0xff)
}

// expand carries a `bits`-bit value onto 8 bits by replicating the high bits.
func expand(v, bits int) int {
	if bits >= 8 {
		return v & 0xff
	}
	return ((v << uint(8-bits)) | (v >> uint(2*bits-8))) & 0xff
}

// decodeBC7Block writes a 4x4 block into img at (bx*4, by*4). Returns true if the block
// was decoded exactly, false if it was subject to the fallback.
func decodeBC7Block(block []byte, img *image.NRGBA, x0, y0 int, guide *image.NRGBA) bool {
	mode := bc7Mode(block[0])
	r := &bitReader{b: block}
	switch mode {
	case 4:
		r.read(5)
		rot := r.read(2)
		idxMode := r.read(1)
		var c [2][3]int
		for ch := 0; ch < 3; ch++ {
			c[0][ch] = expand(r.read(5), 5)
			c[1][ch] = expand(r.read(5), 5)
		}
		a0 := expand(r.read(6), 6)
		a1 := expand(r.read(6), 6)
		i2 := readIdx(r, 2)
		i3 := readIdx(r, 3)
		cw, aw := i2, i3
		cbits, abits := 2, 3
		if idxMode == 1 {
			cw, aw = i3, i2
			cbits, abits = 3, 2
		}
		writeBlock(img, x0, y0, c, a0, a1, cw, aw, cbits, abits, rot)
		return true
	case 5:
		r.read(6)
		rot := r.read(2)
		var c [2][3]int
		for ch := 0; ch < 3; ch++ {
			c[0][ch] = expand(r.read(7), 7)
			c[1][ch] = expand(r.read(7), 7)
		}
		a0 := r.read(8)
		a1 := r.read(8)
		cw := readIdx(r, 2)
		aw := readIdx(r, 2)
		writeBlock(img, x0, y0, c, a0, a1, cw, aw, 2, 2, rot)
		return true
	case 6:
		r.read(7)
		var c [2][3]int
		raw := [2][3]int{}
		for ch := 0; ch < 3; ch++ {
			raw[0][ch] = r.read(7)
			raw[1][ch] = r.read(7)
		}
		ra0 := r.read(7)
		ra1 := r.read(7)
		p0 := r.read(1)
		p1 := r.read(1)
		for ch := 0; ch < 3; ch++ {
			c[0][ch] = (raw[0][ch] << 1) | p0
			c[1][ch] = (raw[1][ch] << 1) | p1
		}
		a0 := (ra0 << 1) | p0
		a1 := (ra1 << 1) | p1
		w := readIdx(r, 4)
		writeBlock(img, x0, y0, c, a0, a1, w, w, 4, 4, 0)
		return true
	case 7:
		if decodeMode7(block, img, x0, y0, guide) {
			return true
		}
		fallbackBlock(block, img, x0, y0, mode)
		return false
	default:
		fallbackBlock(block, img, x0, y0, mode)
		return false
	}
}

// readIdx reads 16 `bits`-bit indices; the FIRST (anchor) carries one less, its high bit
// being implicitly zero.
func readIdx(r *bitReader, bits int) [16]int {
	var out [16]int
	out[0] = r.read(bits - 1)
	for i := 1; i < 16; i++ {
		out[i] = r.read(bits)
	}
	return out
}

func weightOf(bits, i int) int {
	switch bits {
	case 2:
		return bc7W2[i&3]
	case 3:
		return bc7W3[i&7]
	default:
		return bc7W4[i&15]
	}
}

func writeBlock(img *image.NRGBA, x0, y0 int, c [2][3]int, a0, a1 int,
	cw, aw [16]int, cbits, abits, rot int) {
	b := img.Bounds()
	for i := 0; i < 16; i++ {
		x, y := x0+i%4, y0+i/4
		if x >= b.Dx() || y >= b.Dy() {
			continue
		}
		wc := weightOf(cbits, cw[i])
		wa := weightOf(abits, aw[i])
		px := [4]uint8{
			interp(c[0][0], c[1][0], wc),
			interp(c[0][1], c[1][1], wc),
			interp(c[0][2], c[1][2], wc),
			interp(a0, a1, wa),
		}
		// rotation: the alpha channel is swapped with R, G or B.
		switch rot {
		case 1:
			px[0], px[3] = px[3], px[0]
		case 2:
			px[1], px[3] = px[3], px[1]
		case 3:
			px[2], px[3] = px[3], px[2]
		}
		o := img.PixOffset(x, y)
		copy(img.Pix[o:o+4], px[:])
	}
}

// fallbackBlock — multi-subset modes (0-3, 7). The partition tables are NOT reproduced
// here; the block is filled with a single color read from its first endpoint fields.
// The approximation is ASSUMED and counted, never silent.
func fallbackBlock(block []byte, img *image.NRGBA, x0, y0, mode int) {
	r := &bitReader{b: block}
	if mode < 0 {
		mode = 0
	}
	r.read(mode + 1)
	var cb, ab, pb int
	switch mode {
	case 0:
		cb, ab, pb = 4, 0, 4
	case 1:
		cb, ab, pb = 6, 0, 6
	case 2:
		cb, ab, pb = 5, 0, 6
	case 3:
		cb, ab, pb = 7, 0, 6
	case 7:
		cb, ab, pb = 5, 5, 6
	default:
		cb, ab, pb = 7, 7, 0
	}
	r.read(pb) // partition — not used (see the file header)
	nEnd := 4
	if mode == 0 || mode == 2 {
		nEnd = 6
	}
	sum := [3]int{}
	for ch := 0; ch < 3; ch++ {
		for e := 0; e < nEnd; e++ {
			sum[ch] += expand(r.read(cb), cb)
		}
	}
	alpha := 255
	if ab > 0 {
		as := 0
		for e := 0; e < nEnd; e++ {
			as += expand(r.read(ab), ab)
		}
		alpha = as / nEnd
	}
	b := img.Bounds()
	for i := 0; i < 16; i++ {
		x, y := x0+i%4, y0+i/4
		if x >= b.Dx() || y >= b.Dy() {
			continue
		}
		o := img.PixOffset(x, y)
		img.Pix[o] = uint8(sum[0] / nEnd)
		img.Pix[o+1] = uint8(sum[1] / nEnd)
		img.Pix[o+2] = uint8(sum[2] / nEnd)
		img.Pix[o+3] = uint8(alpha)
	}
}

// decodeBC7 renders the w*h image carried by `data` (4x4 blocks, 16 bytes, row-major).
//
// `guide` is the upscaled lower mip level, or nil. It serves ONLY THE MODE 7 BLOCKS,
// whose partition and anchor positions are not reproduced here: it lets them be
// reconstructed by fitting instead of rendered flat (cf. bc7_mode7.go).
//
// The three returned counters distinguish what DEGRADES the deliverable from what does
// not — the distinction matters, because only the alpha is kept in the final glyph:
//
//	rebuilt  mode 7 blocks rebuilt on the witness: alpha RECONSTRUCTED;
//	opaque   mode 0 to 3 blocks: these modes have NO alpha channel, so their alpha is 255
//	         everywhere and the fallback renders it EXACTLY — only the RGB is approximated,
//	         and the RGB is dropped. This counter signals no degradation of the deliverable;
//	degraded mode 7 blocks WITHOUT a witness: alpha rendered flat. The only real degradation.
func decodeBC7(data []byte, w, h int, guide *image.NRGBA) (img *image.NRGBA, rebuilt, opaque, degraded int) {
	bw, bh := (w+3)/4, (h+3)/4
	img = image.NewNRGBA(image.Rect(0, 0, w, h))
	for by := 0; by < bh; by++ {
		for bx := 0; bx < bw; bx++ {
			o := (by*bw + bx) * 16
			if o+16 > len(data) {
				continue
			}
			block := data[o : o+16]
			mode := bc7Mode(block[0])
			if decodeBC7Block(block, img, bx*4, by*4, guide) {
				if mode == 7 {
					rebuilt++
				}
				continue
			}
			if mode == 7 {
				degraded++
				continue
			}
			opaque++
		}
	}
	return img, rebuilt, opaque, degraded
}
