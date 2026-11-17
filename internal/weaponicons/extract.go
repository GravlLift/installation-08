// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// extract.go — from the archives to the PNG: entry index, resource table, image-to-resource
// pairing, BC7 decoding and the glyph render.

package weaponicons

import (
	"encoding/binary"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// GameRootFound says whether a game install is resolvable for gameRoot (an explicit path
// only counts when it exists; otherwise the auto-detection through himap applies). It is
// the startup probe: a build is enqueued only when the game is there to be read from.
func GameRootFound(gameRoot string) bool {
	if gameRoot != "" {
		if fi, err := os.Stat(gameRoot); err == nil && fi.IsDir() {
			return true
		}
		return false
	}
	_, err := himap.DeployRoot()
	return err == nil
}

// moduleRoot returns the `deploy` root of the Halo Infinite install. An explicit gameRoot
// (the build flag) wins; otherwise the resolution of the known roots goes through himap —
// the single source of the game paths.
func moduleRoot(gameRoot string) string {
	if gameRoot != "" {
		return gameRoot
	}
	root, err := himap.DeployRoot()
	if err != nil {
		return ""
	}
	return root
}

// tagRef names one .module entry.
type tagRef struct {
	Module string
	Entry  int
	Group  string
	ID     uint32
}

type tagIndex struct {
	byID    map[uint32][]tagRef
	byGroup map[string][]tagRef
	nEntry  int
	nMods   int
	opened  map[string]*hmod
	atlases map[uint32]*atlas
}

// listModules walks the deploy root and lists the .module archives, optionally filtered by
// a token of the path.
func listModules(root, only string) []string {
	if root == "" {
		return nil
	}
	var mods []string
	_ = filepath.Walk(root, func(p string, fi os.FileInfo, err error) error {
		if err != nil || fi.IsDir() || !strings.HasSuffix(p, ".module") {
			return nil
		}
		if only != "" && !strings.Contains(filepath.ToSlash(p), only) {
			return nil
		}
		mods = append(mods, p)
		return nil
	})
	sort.Strings(mods)
	return mods
}

func fourCCLE(v uint32) string {
	b := []byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}
	for i, c := range b {
		if c < 0x20 || c > 0x7e {
			b[i] = '.'
		}
	}
	return string(b)
}

// readEntryTable reads ONLY the header + entry table: the archives are several gigabytes
// (globals-rtx-new = 7.8 GiB), loading them to index them would be absurd.
func readEntryTable(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	head := make([]byte, 0x48)
	if _, err := f.ReadAt(head, 0); err != nil {
		return nil, err
	}
	if string(head[:4]) != "mohd" {
		return nil, fmt.Errorf("magic mohd absent")
	}
	n := int(binary.LittleEndian.Uint32(head[0x10:]))
	if n <= 0 || n > 4_000_000 {
		return nil, fmt.Errorf("fileCount absurd: %d", n)
	}
	buf := make([]byte, 0x48+n*0x58)
	if _, err := f.ReadAt(buf, 0); err != nil {
		return nil, err
	}
	return buf, nil
}

// buildIndex indexes every entry of the deploy root by global tag id and group.
func buildIndex(only string) *tagIndex {
	ix := &tagIndex{
		byID:    map[uint32][]tagRef{},
		byGroup: map[string][]tagRef{},
		opened:  map[string]*hmod{},
		atlases: map[uint32]*atlas{},
	}
	root := moduleRoot("")
	for _, mp := range listModules(root, only) {
		data, err := readEntryTable(mp)
		if err != nil {
			continue
		}
		n := int(binary.LittleEndian.Uint32(data[0x10:]))
		if n <= 0 || 0x48+n*0x58 > len(data) {
			continue
		}
		ix.nMods++
		ix.nEntry += n
		for i := 0; i < n; i++ {
			e := 0x48 + i*0x58
			id := binary.LittleEndian.Uint32(data[e+0x28:])
			grp := fourCCLE(binary.LittleEndian.Uint32(data[e+0x14:]))
			r := tagRef{Module: mp, Entry: i, Group: grp, ID: id}
			ix.byID[id] = append(ix.byID[id], r)
			ix.byGroup[grp] = append(ix.byGroup[grp], r)
		}
	}
	return ix
}

func (ix *tagIndex) open(path string) (*hmod, error) {
	if m, ok := ix.opened[path]; ok {
		return m, nil
	}
	m, err := hmOpen(path)
	if err != nil {
		return nil, err
	}
	ix.opened[path] = m
	return m, nil
}

func (ix *tagIndex) extract(r tagRef) ([]byte, error) {
	m, err := ix.open(r.Module)
	if err != nil {
		return nil, err
	}
	if r.Entry >= m.hdr.FileCount {
		return nil, fmt.Errorf("entry %d out of range (%d)", r.Entry, m.hdr.FileCount)
	}
	return m.extract(m.file(r.Entry))
}

// pickRef chooses the archive variant that carries the pixels. The `ds/` (dedicated
// server) variant declares the same tags but its resource index is 0: it has no images.
// The `pc/` variant does.
func pickRef(refs []tagRef) (tagRef, bool) {
	for _, r := range refs {
		if strings.Contains(filepath.ToSlash(r.Module), "/pc/") {
			return r, true
		}
	}
	if len(refs) > 0 {
		return refs[0], true
	}
	return tagRef{}, false
}

// resourceTable reads an archive's resource table: res[i] -> entry index.
// Layout: [file entries][strings][2 u32 sentinels][resources u32][blocks].
func resourceTable(m *hmod) ([]uint32, error) {
	resOff := int64(0x48) + int64(m.hdr.FileCount)*0x58 + int64(m.hdr.StringsSize) + 8
	raw, err := m.readAt(resOff, m.hdr.ResourceCount*4)
	if err != nil {
		return nil, err
	}
	out := make([]uint32, m.hdr.ResourceCount)
	for i := range out {
		out[i] = binary.LittleEndian.Uint32(raw[i*4:])
	}
	return out, nil
}

// entryResourceIndex: the entry's field at +0x10 is the index into the resource table.
func entryResourceIndex(m *hmod, entry int) int {
	return int(binary.LittleEndian.Uint32(m.entries[entry*0x58+0x10:]))
}

// imgStride: the stride of the image descriptor array, MEASURED (0xe8 -> 0x110 -> 0x138 on
// the three atlases examined). imgProbe is the window needed to verify the signature.
const (
	imgStride = 0x28
	imgProbe  = 0x2c
)

// bitmImg describes one image declared by a `bitm` tag.
type bitmImg struct {
	Off    int
	W, H   int
	Depth  int
	Format int
	Mips   int
}

// scanImgs lists the images declared by a tag body.
//
// TWO STEPS, AND THE SECOND ONE IS WHAT KILLED THE DRIFT. A plain sweep (looking anywhere
// for the "dimensions repeated at +0x14" signature) found 91 records where the tag
// declares 88, and 24 where it declares 22: the false positives consumed resources and
// shifted everything after, hence the striped images at the tail of the atlas.
//
// The sweep therefore only FINDS THE FIRST record — its offset is not hardcoded, it is
// recovered, which keeps the read robust across versions. Then the array is read as it is:
// a count (the u32 right before the first record) and a regular 0x28-byte stride, both
// measured on the three atlases examined.
func scanImgs(data []byte) []bitmImg {
	u16 := func(o int) int { return int(binary.LittleEndian.Uint16(data[o:])) }
	first := -1
	for o := 0; o+imgProbe <= len(data); o += 4 {
		w, h := u16(o), u16(o+2)
		if w < 4 || h < 4 || w > 8192 || h > 8192 {
			continue
		}
		if u16(o+0x14) != w || u16(o+0x16) != h {
			continue
		}
		first = o
		break
	}
	if first < 0 {
		return nil
	}
	count := 0
	if first >= 4 {
		count = int(binary.LittleEndian.Uint32(data[first-4:]))
	}
	// The count must stay plausible AND fit in the tag body; otherwise fall back to what
	// the body can hold, rather than trusting a field that was misread.
	if max := (len(data) - first) / imgStride; count <= 0 || count > max {
		count = max
	}
	out := make([]bitmImg, 0, count)
	for i := 0; i < count; i++ {
		o := first + i*imgStride
		out = append(out, bitmImg{
			Off: o, W: u16(o), H: u16(o + 2),
			Depth: u16(o + 4), Format: u16(o + 8), Mips: u16(o + 0x0a),
		})
	}
	return out
}

// glyphStats reports what the decode had to approximate on one image.
type glyphStats struct {
	Blocks   int // 4x4 blocks of mip0
	Rebuilt  int // mode 7 blocks rebuilt by fitting to the lower mip
	Opaque   int // mode 0-3 blocks: no alpha channel, alpha exactly 255, RGB approximated (dropped)
	Degraded int // mode 7 blocks without a witness: alpha flat — the only real degradation
}

// mipGuide decodes the NEXT mip level (half size) and upscales it, to serve as a witness
// for the mode 7 block reconstruction. Returns nil if the resource does not carry that
// level — the decoder then falls back to the flat fill, as before.
func mipGuide(blob []byte, px, w, h int) *image.NRGBA {
	off := px + bcSize(w, h)
	w1, h1 := max1(w/2), max1(h/2)
	need := bcSize(w1, h1)
	if off+need > len(blob) {
		return nil
	}
	small, _, _, _ := decodeBC7(blob[off:off+need], w1, h1, nil)
	return upscale2(small, w, h)
}

// decodeAlphaGlyph renders image `idx` of tag `id` as a WHITE glyph on a transparent
// background, cropped to its bounding box. It also returns what the decode had to
// approximate.
func decodeAlphaGlyph(ix *tagIndex, id uint32, idx int) (*image.NRGBA, glyphStats, bitmImg, error) {
	var st glyphStats
	blob, px, im, err := resBlob(ix, id, idx)
	if err != nil {
		return nil, st, im, err
	}
	bw, bh := (im.W+3)/4, (im.H+3)/4
	need := bw * bh * 16
	if px+need > len(blob) {
		return nil, st, im, fmt.Errorf("mip0 overflows the resource (%d+%d > %d)", px, need, len(blob))
	}
	src, rebuilt, opaque, degraded := decodeBC7(blob[px:px+need], im.W, im.H, mipGuide(blob, px, im.W, im.H))
	st = glyphStats{Blocks: bw * bh, Rebuilt: rebuilt, Opaque: opaque, Degraded: degraded}
	glyph := image.NewNRGBA(image.Rect(0, 0, im.W, im.H))
	minX, minY, maxX, maxY := im.W, im.H, -1, -1
	for y := 0; y < im.H; y++ {
		for x := 0; x < im.W; x++ {
			a := src.Pix[src.PixOffset(x, y)+3]
			o := glyph.PixOffset(x, y)
			glyph.Pix[o], glyph.Pix[o+1], glyph.Pix[o+2], glyph.Pix[o+3] = 255, 255, 255, a
			if a <= 8 {
				continue
			}
			if x < minX {
				minX = x
			}
			if y < minY {
				minY = y
			}
			if x > maxX {
				maxX = x
			}
			if y > maxY {
				maxY = y
			}
		}
	}
	if maxX < minX || maxY < minY {
		return glyph, st, im, nil
	}
	crop := image.NewNRGBA(image.Rect(0, 0, maxX-minX+1, maxY-minY+1))
	for y := minY; y <= maxY; y++ {
		for x := minX; x <= maxX; x++ {
			so, do := glyph.PixOffset(x, y), crop.PixOffset(x-minX, y-minY)
			copy(crop.Pix[do:do+4], glyph.Pix[so:so+4])
		}
	}
	return crop, st, im, nil
}

// writePNG writes img as a best-compressed PNG.
func writePNG(path string, img image.Image) error {
	f, err := os.Create(path)
	if err != nil {
		return err
	}
	defer func() { _ = f.Close() }()
	enc := png.Encoder{CompressionLevel: png.BestCompression}
	return enc.Encode(f, img)
}

// alphaNoise measures the density of OPACITY TRANSITIONS per pixel, line by line.
//
// What it is for: the arithmetic check validates the WEIGHT of a resource, not its
// content. At the tail of the atlas, false-positive descriptors sometimes land on a
// resource of the right weight: the decode then renders striped noise, plausible to the
// machine and obvious to the eye. An interface drawing has few, sharp contours (measured
// < 0.06 transition per pixel); a misaligned decode has an order of magnitude more.
func alphaNoise(img *image.NRGBA) float64 {
	b := img.Bounds()
	w, h := b.Dx(), b.Dy()
	if w < 2 || h < 1 {
		return 0
	}
	trans := 0
	for y := 0; y < h; y++ {
		prev := img.Pix[img.PixOffset(0, y)+3] > 127
		for x := 1; x < w; x++ {
			cur := img.Pix[img.PixOffset(x, y)+3] > 127
			if cur != prev {
				trans++
				prev = cur
			}
		}
	}
	return float64(trans) / float64(w*h)
}
