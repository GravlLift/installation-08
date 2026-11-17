// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// bc7_mode7.go — MODE 7, the one that makes artifacts.
//
// WHAT REDUCED THE PROBLEM. The exact decoder covers modes 4, 5 and 6; modes 0 to 3 and
// 7 fell to the fallback (flat). But only mode 7 really degrades what is kept: modes 0 to
// 3 have no alpha channel, so their alpha is 255 everywhere — exactly what the fallback
// already produces. On icon #21 of the contour atlas, all 28 fallback blocks are mode 7
// (measured). So there is one mode to handle, not five.
//
// THE LOCK, AND HOW IT IS BYPASSED WITHOUT INVENTING. A multi-subset block needs two
// tables of the format: the partition (which pixel belongs to which subset) and the anchor
// positions (the pixels whose index is written with one less bit). Copying those tables
// from memory would run the risk of a SILENT error — a wrong table renders a plausible but
// false image, and that is the worst case.
//
// The rest of the block is read EXACTLY: field widths, endpoints, P bits, indices. So
// what is missing is recovered by FITTING TO REAL DATA OF THE FILE: the lower mip level,
// decoded in turn and upscaled, serves as a witness. The 15 possible anchor positions are
// tried; for each, every pixel takes the subset whose value fits the witness best; the
// position that minimizes the total error is kept. Nothing is guessed: the measurement
// decides.
//
// HONESTY OF THE RESULT: these blocks are RECONSTRUCTED, not decoded. They are counted
// separately and the count is carried up into index.json (`bc7_rebuilt_pct`).

package weaponicons

import "image"

// mode7IndexBits: the width of a mode 7 index. The first anchor is always pixel 0 (a rule
// of the format, not an assumption); the second is searched.
const mode7IndexBits = 2

// decodeMode7 reads a mode 7 block and writes its pixels. `guide` is the upscaled lower
// mip level, or nil. Returns false when no witness is available: the caller then falls
// back to the flat fill.
func decodeMode7(block []byte, img *image.NRGBA, x0, y0 int, guide *image.NRGBA) bool {
	if guide == nil {
		return false
	}
	r := &bitReader{b: block}
	r.read(8)         // mode
	r.read(6)         // partition — not used, the table is not reproduced here
	var raw [4][4]int // [channel R,G,B,A][endpoint 0..3]
	for ch := 0; ch < 4; ch++ {
		for e := 0; e < 4; e++ {
			raw[ch][e] = r.read(5)
		}
	}
	var p [4]int
	for e := 0; e < 4; e++ {
		p[e] = r.read(1)
	}
	// 5 bits + 1 P bit = 6 significant bits, carried onto 8.
	var ep [4][4]int // [endpoint][channel]
	for e := 0; e < 4; e++ {
		for ch := 0; ch < 4; ch++ {
			ep[e][ch] = expand((raw[ch][e]<<1)|p[e], 6)
		}
	}

	best, bestErr := -1, 1<<62
	var bestPix [16][4]uint8
	for anchor := 1; anchor < 16; anchor++ {
		pix, errSum, ok := mode7Try(block, ep, anchor, guide, img.Bounds(), x0, y0)
		if ok && errSum < bestErr {
			best, bestErr, bestPix = anchor, errSum, pix
		}
	}
	if best < 0 {
		return false
	}
	b := img.Bounds()
	for i := 0; i < 16; i++ {
		x, y := x0+i%4, y0+i/4
		if x >= b.Dx() || y >= b.Dy() {
			continue
		}
		o := img.PixOffset(x, y)
		copy(img.Pix[o:o+4], bestPix[i][:])
	}
	return true
}

// mode7Try reads the index stream for a given anchor position, picks for each pixel the
// subset closest to the witness, and returns the total error.
func mode7Try(block []byte, ep [4][4]int, anchor int, guide *image.NRGBA,
	bounds image.Rectangle, x0, y0 int,
) (pix [16][4]uint8, errSum int, ok bool) {
	r := &bitReader{b: block}
	r.read(8 + 6 + 4*4*5 + 4) // mode + partition + endpoints + P bits
	var idx [16]int
	for i := 0; i < 16; i++ {
		bits := mode7IndexBits
		if i == 0 || i == anchor {
			bits--
		}
		idx[i] = r.read(bits)
	}
	for i := 0; i < 16; i++ {
		w := weightOf(mode7IndexBits, idx[i])
		x, y := x0+i%4, y0+i/4
		var gr, gg, gb, ga int
		hasGuide := x < bounds.Dx() && y < bounds.Dy()
		if hasGuide {
			o := guide.PixOffset(x, y)
			gr, gg, gb, ga = int(guide.Pix[o]), int(guide.Pix[o+1]), int(guide.Pix[o+2]), int(guide.Pix[o+3])
		}
		bestD := 1 << 62
		var bestV [4]uint8
		for s := 0; s < 2; s++ {
			var v [4]uint8
			for ch := 0; ch < 4; ch++ {
				v[ch] = interp(ep[2*s][ch], ep[2*s+1][ch], w)
			}
			if !hasGuide {
				bestV = v
				break
			}
			// Alpha weighs the most: it is the channel kept in the final glyph.
			d := 3*sq(int(v[3])-ga) + sq(int(v[0])-gr) + sq(int(v[1])-gg) + sq(int(v[2])-gb)
			if d < bestD {
				bestD, bestV = d, v
			}
		}
		if hasGuide {
			errSum += bestD
		}
		pix[i] = bestV
	}
	return pix, errSum, true
}

func sq(v int) int { return v * v }

// upscale2 doubles an image by pixel duplication: the witness does not need to be smooth,
// it only needs to say which way each area leans.
func upscale2(src *image.NRGBA, w, h int) *image.NRGBA {
	dst := image.NewNRGBA(image.Rect(0, 0, w, h))
	sw, sh := src.Bounds().Dx(), src.Bounds().Dy()
	if sw == 0 || sh == 0 {
		return dst
	}
	for y := 0; y < h; y++ {
		sy := y / 2
		if sy >= sh {
			sy = sh - 1
		}
		for x := 0; x < w; x++ {
			sx := x / 2
			if sx >= sw {
				sx = sw - 1
			}
			so, do := src.PixOffset(sx, sy), dst.PixOffset(x, y)
			copy(dst.Pix[do:do+4], src.Pix[so:so+4])
		}
	}
	return dst
}
