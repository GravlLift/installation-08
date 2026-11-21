// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// extract.go — from the archives to the PNG: entry index, resource pairing, decoding
// through the shared bitmap decoder and the glyph render.

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

	"github.com/JGtm/halo-infinite-files-reader/himodule"
	"github.com/JGtm/halo-infinite-map-images/bitmapdecode"
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
	opened  map[string]*himodule.Module
	// byEntry maps a module to its entries by their table index: extract needs the entry
	// record (its header fields, its resource index) and himodule does not expose it by
	// index.
	byEntry map[string]map[int]himodule.File
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

// buildIndex indexes every entry of the deploy root by global tag id and group. The
// entries are read through himodule, the shared module reader: it maps the archive
// read-only (a 7.8 GiB archive is never loaded into memory), it carries the header
// fields of every entry (the `ucsh` split: HeaderSize, TagDataSize, ActualResourceSize)
// and it reads the entries that live in the companion `.module_hd1` file, which the
// local reader could not see.
func buildIndex(only string) *tagIndex {
	ix := &tagIndex{
		byID:    map[uint32][]tagRef{},
		byGroup: map[string][]tagRef{},
		opened:  map[string]*himodule.Module{},
		byEntry: map[string]map[int]himodule.File{},
		atlases: map[uint32]*atlas{},
	}
	root := moduleRoot("")
	for _, mp := range listModules(root, only) {
		m, err := himodule.Open(mp)
		if err != nil {
			continue
		}
		ix.opened[mp] = m
		ix.nMods++
		all := m.Files("")
		ents := make(map[int]himodule.File, len(all))
		for _, f := range all {
			ix.nEntry++
			ents[f.Index] = f
			r := tagRef{Module: mp, Entry: f.Index, Group: f.Group, ID: f.GlobalID}
			ix.byID[f.GlobalID] = append(ix.byID[f.GlobalID], r)
			ix.byGroup[f.Group] = append(ix.byGroup[f.Group], r)
		}
		ix.byEntry[mp] = ents
	}
	return ix
}

func (ix *tagIndex) open(path string) (*himodule.Module, error) {
	if m, ok := ix.opened[path]; ok {
		return m, nil
	}
	m, err := himodule.Open(path)
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
	f, ok := ix.byEntry[r.Module][r.Entry]
	if !ok {
		return nil, fmt.Errorf("entry %d out of range in %s", r.Entry, r.Module)
	}
	return m.Extract(f)
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

// imgStride: the stride of the image descriptor array of a `bitm` tag (40 bytes per
// record, the `bitmaps` block reached through the tag's own tables — see bitmapHeader).
const imgStride = 0x28

// bitmImg describes one image declared by a `bitm` tag.
type bitmImg struct {
	Off    int
	W, H   int
	Depth  int
	Format int
	Mips   int
}

// scanImgs lists the images declared by the tag body (the bytes past the `ucsh`
// header), through the bitmap header: the tag's own block tables point at the
// `bitmaps` record array, so no signature hunting is involved.
func scanImgs(data []byte) []bitmImg {
	u16 := func(o int) int { return int(binary.LittleEndian.Uint16(data[o:])) }
	e, err := readBitmHdr(data)
	if err != nil {
		return nil
	}
	if e.count <= 0 || e.off < 0 || e.off+e.count*imgStride > len(data) {
		return nil
	}
	out := make([]bitmImg, 0, e.count)
	for i := 0; i < e.count; i++ {
		o := e.off + i*imgStride
		out = append(out, bitmImg{
			Off: o, W: u16(o), H: u16(o + 2),
			Depth: u16(o + 4), Format: u16(o + 8), Mips: u16(o + 0x0a),
		})
	}
	return out
}

// decodeAlphaGlyph renders image `idx` of tag `id` as a WHITE glyph on a transparent
// background, cropped to its bounding box. The pixels of the image come from the tag's
// own `bitmaps` record: the format is the record's, decoded through the shared
// bitmapdecode (no format is assumed by the caller).
func decodeAlphaGlyph(ix *tagIndex, id uint32, idx int) (*image.NRGBA, bitmImg, error) {
	im, px, fm, ok := atlasImageInfo(ix, id, idx)
	if !ok {
		return nil, bitmImg{}, fmt.Errorf("atlas image %d of tag %08x not readable", idx, id)
	}
	src, err := fm.Decode(px, im.W, im.H, bitmapdecode.Tight)
	if err != nil {
		return nil, bitmImg{}, fmt.Errorf("atlas image %d of tag %08x: %w", idx, id, err)
	}
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
		return glyph, im, nil
	}
	crop := image.NewNRGBA(image.Rect(0, 0, maxX-minX+1, maxY-minY+1))
	for y := minY; y <= maxY; y++ {
		for x := minX; x <= maxX; x++ {
			so, do := glyph.PixOffset(x, y), crop.PixOffset(x-minX, y-minY)
			copy(crop.Pix[do:do+4], glyph.Pix[so:so+4])
		}
	}
	return crop, im, nil
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
