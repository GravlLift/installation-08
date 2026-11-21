// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// LOCAL-CHANGE (infinite-theater-3d): new package, ported from The Library's
// mapextractor/bitmapdecode (2026-11-21) without changes to its code.

// Package bitmapdecode decodes one mip level of a Halo Infinite bitmap (`bitm`) into an 8-bit
// image. It is the one decode path of himap's bitmap readers (litBitmap and the readers built on its
// levels), and it holds the engine's format table once. It depends only on bcn and the standard
// library.
//
// FORMATS. The engine's format enum (Ekur `BitmapFormat`; the names are those of
// Z-15/Halo-Infinite-Tag-Editor `Tag_Structures/bitm.xml`) maps to a decoder: the BCn block formats
// and the 8-bit formats go through github.com/woozymasta/bcn, BC6H through bcn's half-float API
// (DecodeBC6H), and the 16-bit, 32-bit and packed float formats are read here from their DXGI bit
// layouts (float.go, raw.go). Every decode returns an *image.NRGBA, the type both readers'
// consumers take.
//
// HDR. BC6H and the float formats hold linear-light values that may exceed 1. For the 8-bit
// consumers they are tone mapped with the extended Reinhard operator (Reinhard et al. 2002,
// "Photographic Tone Reproduction for Digital Images", eq. 4), applied per channel with the image's
// largest RGB value as white point (at least 1, so an image within [0, 1] passes unchanged), then
// encoded with the sRGB transfer function (IEC 61966-2-1). Negative and NaN values read as 0.
// Alpha (rgba16f, rgba32f) is clamped to [0, 1], never tone mapped.
//
// ONE CHANNEL. A mono format (a8, r8, bc4, r16_unorm_rrr0) has its channel copied into R, G and B
// with alpha 255: the convention both readers' consumers rely on (himap's `Monocanal`).
//
// ROW PITCH. A level stored in a resource entry has each row (of pixels, or of 4x4 blocks) padded
// to a multiple of 256 bytes, the D3D12 texture data pitch alignment; inline pixels (after the tag
// data) are tight. Measured on the whole installation (2026-11-21): of the resource-backed
// bitmaps whose tight row is not a multiple of 256 bytes, the top level holds exactly the pitched
// size on all 97 single-image ones (70 2D, 5 arrays, 6 in a container entry, 16 first images of a
// multi-record bitmap) and the tight size on none; of the inline ones whose mip chain differs
// between the two layouts, 9602 hold the tight chain and 2 the pitched one.
//
// ERRORS. bcn's DecodeImage splits a large image across worker goroutines and drops their errors
// (bcn v0.7.0, decode_pool.go: `_ = decodeBlockRange(...)`), so a format its block decoder refuses
// (BC6H) came back as a blank image with a nil error. Decode hands bcn only the formats of bcnSafe,
// which its block decoder never refuses (TestBCnSafeNeverRefused); every other format is decoded
// elsewhere, and a short buffer is an error before any decoder runs.
package bitmapdecode

import (
	"errors"
	"fmt"
	"image"

	"github.com/woozymasta/bcn"
)

// Errors of Decode.
var (
	// ErrShortData: the buffer holds fewer bytes than the level needs.
	ErrShortData = errors.New("bitmapdecode: fewer bytes than the level needs")
	// ErrDimensions: a width or height that is not positive.
	ErrDimensions = errors.New("bitmapdecode: invalid dimensions")
	// ErrUnsafeBCn: a bcn format outside bcnSafe was about to reach bcn.DecodeImage.
	ErrUnsafeBCn = errors.New("bitmapdecode: bcn format whose errors bcn may drop")
)

// pitchAlign is the row alignment of a level stored in a resource entry, in bytes.
const pitchAlign = 256

// Layout is how the rows of a level are laid out in its buffer.
type Layout uint8

const (
	// Tight rows follow one another (inline pixels).
	Tight Layout = iota
	// Pitched rows are padded to a multiple of 256 bytes (resource entries).
	Pitched
)

// kind selects a format's decoder.
type kind uint8

const (
	viaBCn  kind = iota // bcn.DecodeImage
	viaBC6H             // bcn.DecodeBC6H, then tone mapped
	viaRaw              // a decoder of raw.go or float.go
)

// Format is one engine bitmap format as the decoder reads it.
type Format struct {
	// Name is the format's name in bitm.xml.
	Name       string
	mono       bool
	compressed bool
	bytes      int // per 4x4 block when compressed, per pixel otherwise
	k          kind
	bc         bcn.Format // viaBCn
	signed     bool       // viaBC6H
	raw        func(px []byte, w, h int) *image.NRGBA
}

// Mono says whether the format holds one channel, copied into R, G and B on decode.
func (f Format) Mono() bool { return f.mono }

// Compressed says whether the format is stored in 4x4 blocks.
func (f Format) Compressed() bool { return f.compressed }

// rowBytes is the tight byte size of one row of pixels (one row of blocks when compressed) of a
// w x h level, and the number of such rows.
func (f Format) rowBytes(w, h int) (row, rows int) {
	if f.compressed {
		return (w + 3) / 4 * f.bytes, (h + 3) / 4
	}
	return w * f.bytes, h
}

// LevelSize is the byte size of a w x h level laid out tight.
func (f Format) LevelSize(w, h int) int {
	row, rows := f.rowBytes(w, h)
	return row * rows
}

// PitchedSize is the byte size of a w x h level whose rows are padded to 256 bytes.
func (f Format) PitchedSize(w, h int) int {
	row, rows := f.rowBytes(w, h)
	return (row + pitchAlign - 1) / pitchAlign * pitchAlign * rows
}

// ResourceLayout is the layout of a w x h level stored alone in a resource entry of n bytes: Pitched
// when the entry holds the pitched size, Tight otherwise (the rows are then aligned already, or the
// entry is too short for either and Decode says so).
func (f Format) ResourceLayout(n, w, h int) Layout {
	if p := f.PitchedSize(w, h); p != f.LevelSize(w, h) && n >= p {
		return Pitched
	}
	return Tight
}

// formats maps the engine's format enum to its decoder. Values absent are not read.
var formats = map[int]Format{
	0:  bcnFormat("a8_unorm", bcn.FormatA8, true, 1),
	1:  bcnFormat("r8_unorm_rrr1", bcn.FormatR8, true, 1),
	2:  bcnFormat("r8_unorm_rrrr", bcn.FormatR8, true, 1),
	3:  bcnFormat("r8g8_unorm_rrrg", bcn.FormatRG8, false, 2),
	10: bcnFormat("b8g8r8x8_unorm", bcn.FormatBGRX8, false, 4),
	11: bcnFormat("b8g8r8a8_unorm", bcn.FormatBGRA8, false, 4),
	14: bcnFormat("bc1_unorm", bcn.FormatBC1, false, 8),
	15: bcnFormat("bc2_unorm", bcn.FormatBC2, false, 16),
	16: bcnFormat("bc3_unorm", bcn.FormatBC3, false, 16),
	22: bcnFormat("r8g8_snorm", bcn.FormatRG8S, false, 2),
	24: rawFormat("r32g32b32a32_float", 16, false, decodeRGBA32F),
	25: rawFormat("r16g16b16a16_float", 8, false, decodeRGBA16F),
	28: rawFormat("r8g8b8a8_snorm", 4, false, decodeRGBA8S),
	29: bcnFormat("r10g10b10a2_unorm", bcn.FormatRGB10A2, false, 4),
	30: rawFormat("r16g16b16a16_unorm", 8, false, decodeRGBA16),
	32: rawFormat("r16_unorm_rrr0", 2, true, decodeR16),
	33: rawFormat("r16g16_unorm", 4, false, decodeRG16),
	34: rawFormat("r16g16b16a16_snorm", 8, false, decodeRGBA16S),
	36: bcnFormat("bc4_unorm_rrrr", bcn.FormatBC4, true, 8),
	37: bcnFormat("bc4_snorm_rrrr", bcn.FormatBC4S, true, 8),
	39: bcnFormat("bc5_snorm", bcn.FormatBC5S, false, 16),
	43: bcnFormat("bc4_unorm_000r", bcn.FormatBC4, true, 8),
	44: bcnFormat("bc4_unorm_rrr1", bcn.FormatBC4, true, 8),
	45: bcnFormat("bc5_unorm_rrrg", bcn.FormatBC5, false, 16),
	46: bcnFormat("bc5_snorm_rrrg", bcn.FormatBC5S, false, 16),
	47: {Name: "bc6h_uf16", compressed: true, bytes: 16, k: viaBC6H},
	48: {Name: "bc6h_sf16", compressed: true, bytes: 16, k: viaBC6H, signed: true},
	49: bcnFormat("bc7_unorm", bcn.FormatBC7, false, 16),
	51: rawFormat("r11g11b10_float", 4, false, decodeR11G11B10F),
}

// bcnSafe are the bcn formats bcn.DecodeImage decodes without an error its parallel path could
// drop: its block decoder handles every compressed one, and its uncompressed path (single-threaded)
// returns its errors.
var bcnSafe = map[bcn.Format]bool{
	bcn.FormatA8: true, bcn.FormatR8: true, bcn.FormatRG8: true, bcn.FormatRG8S: true,
	bcn.FormatBGRX8: true, bcn.FormatBGRA8: true, bcn.FormatRGB10A2: true,
	bcn.FormatBC1: true, bcn.FormatBC2: true, bcn.FormatBC3: true, bcn.FormatBC4: true,
	bcn.FormatBC4S: true, bcn.FormatBC5: true, bcn.FormatBC5S: true, bcn.FormatBC7: true,
}

func bcnFormat(name string, f bcn.Format, mono bool, bytes int) Format {
	compressed := f != bcn.FormatA8 && f != bcn.FormatR8 && f != bcn.FormatRG8 && f != bcn.FormatRG8S &&
		f != bcn.FormatBGRX8 && f != bcn.FormatBGRA8 && f != bcn.FormatRGB10A2
	return Format{Name: name, mono: mono, compressed: compressed, bytes: bytes, k: viaBCn, bc: f}
}

func rawFormat(name string, bytes int, mono bool, fn func(px []byte, w, h int) *image.NRGBA) Format {
	return Format{Name: name, mono: mono, bytes: bytes, k: viaRaw, raw: fn}
}

// Lookup returns the decoder of engine format v, false when the format is not read.
func Lookup(v int) (Format, bool) {
	f, ok := formats[v]
	return f, ok
}

// Decode decodes the first w x h level of data, laid out as l. Bytes past the level (smaller
// levels, padding) are ignored.
func (f Format) Decode(data []byte, w, h int, l Layout) (*image.NRGBA, error) {
	if w <= 0 || h <= 0 {
		return nil, fmt.Errorf("%w: %dx%d", ErrDimensions, w, h)
	}
	px, err := f.tight(data, w, h, l)
	if err != nil {
		return nil, err
	}
	var img *image.NRGBA
	switch f.k {
	case viaBC6H:
		img, err = decodeBC6H(px, w, h, f.signed)
	case viaRaw:
		img = f.raw(px, w, h)
	default:
		img, err = decodeBCn(px, w, h, f.bc)
	}
	if err != nil {
		return nil, fmt.Errorf("bitmapdecode: %s %dx%d: %w", f.Name, w, h, err)
	}
	if f.mono && f.k == viaBCn {
		alpha := f.bc == bcn.FormatA8
		for i := 0; i+3 < len(img.Pix); i += 4 {
			v := img.Pix[i]
			if alpha {
				v = img.Pix[i+3]
			}
			img.Pix[i], img.Pix[i+1], img.Pix[i+2], img.Pix[i+3] = v, v, v, 255
		}
	}
	return img, nil
}

// tight returns the level's bytes with its rows packed, or ErrShortData.
func (f Format) tight(data []byte, w, h int, l Layout) ([]byte, error) {
	size := f.LevelSize(w, h)
	if l == Tight {
		if len(data) < size {
			return nil, fmt.Errorf("%w: %d bytes for a %dx%d %s level of %d", ErrShortData, len(data), w, h, f.Name, size)
		}
		return data[:size], nil
	}
	row, rows := f.rowBytes(w, h)
	pitch := (row + pitchAlign - 1) / pitchAlign * pitchAlign
	// The last row needs no padding after it.
	if need := pitch*(rows-1) + row; len(data) < need {
		return nil, fmt.Errorf("%w: %d bytes for a %dx%d %s level of %d (rows pitched to %d)", ErrShortData, len(data), w, h, f.Name, need, pitch)
	}
	if pitch == row {
		return data[:size], nil
	}
	out := make([]byte, size)
	for y := range rows {
		copy(out[y*row:(y+1)*row], data[y*pitch:y*pitch+row])
	}
	return out, nil
}

// decodeBCn decodes through bcn.DecodeImage a format of bcnSafe, and refuses any other: bcn's
// parallel path would drop its error and return a blank image.
func decodeBCn(px []byte, w, h int, f bcn.Format) (*image.NRGBA, error) {
	if !bcnSafe[f] {
		return nil, fmt.Errorf("%w: %v", ErrUnsafeBCn, f)
	}
	return bcn.DecodeImage(px, w, h, f)
}

// decodeBC6H decodes BC6H through bcn's half-float API (a port of bcdec's bcdec_bc6h_half, whose
// two dispatch paths both return their errors) and tone maps the result.
func decodeBC6H(px []byte, w, h int, signed bool) (*image.NRGBA, error) {
	rgb, err := bcn.DecodeBC6HFloat32(px, w, h, signed)
	if err != nil {
		return nil, err
	}
	hdr := make([]float32, w*h*4)
	for i := range w * h {
		hdr[i*4], hdr[i*4+1], hdr[i*4+2], hdr[i*4+3] = rgb[i*3], rgb[i*3+1], rgb[i*3+2], 1
	}
	return toneMap(hdr, w, h), nil
}
