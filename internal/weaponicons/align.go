// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// align.go — one icon `bitm` atlas tag, its declared images, and the decode of each
// image through the shared bitmap decoder.
//
// The pixels of an atlas image live either INLINE in the tag (the small atlases: after
// the header and the tag data, level by level from the largest, one level after another,
// tight rows) or in the tag's RESOURCE entries (one mip level per entry, each row
// padded to 256 bytes, from the smallest level to the largest). The two cases are told
// apart by the entry's own `ucsh` fields (ActualResourceSize, measured on the install),
// the same split himap's bitmap reader uses.

package weaponicons

import (
	"encoding/binary"
	"fmt"

	"github.com/JGtm/halo-infinite-map-images/bitmapdecode"
)

// atlas: one icon `bitm` tag, its declared images, its pixel format (the bitmap header's
// own) and, per image, the bytes of that image's mip chain (mip 0 first, tight rows). The
// pairing is done once per tag, then cached.
type atlas struct {
	imgs     []bitmImg
	fm       bitmapdecode.Format
	payloads [][]byte
}

// atlasOf decodes the tag once and for all: it reads the `bitm` header (the record
// array, the format), extracts the tag, and collects the pixels of every declared image.
func atlasOf(ix *tagIndex, id uint32) (*atlas, error) {
	if a, ok := ix.atlases[id]; ok {
		if a == nil {
			return nil, fmt.Errorf("tag %08x not usable", id)
		}
		return a, nil
	}
	a := &atlas{}
	ix.atlases[id] = a
	return a, buildAtlas(a, ix, id)
}

// buildAtlas fills a for tag id. The format is the one the tag's own bitmap header
// declares (never assumed by the caller): an unknown format leaves the atlas empty.
func buildAtlas(a *atlas, ix *tagIndex, id uint32) error {
	r, ok := pickRef(ix.byID[id])
	if !ok {
		return fmt.Errorf("tag %08x absent from the archives", id)
	}
	m, err := ix.open(r.Module)
	if err != nil {
		return err
	}
	f, ok := ix.byEntry[r.Module][r.Entry]
	if !ok {
		return fmt.Errorf("entry %d out of range in %s", r.Entry, r.Module)
	}
	data, err := m.Extract(f)
	if err != nil {
		return err
	}
	body := data
	if n := f.HeaderSize + f.TagDataSize; n > 0 && n <= len(data) {
		body = data[:n]
	}
	e, err := readBitmHdr(body)
	if err != nil {
		return err
	}
	fm, ok := bitmapdecode.Lookup(e.format)
	if !ok {
		return fmt.Errorf("tag %08x: unsupported bitmap format %d", id, e.format)
	}
	all := scanImgs(body)
	a.imgs = all
	a.fm = fm
	if f.ActualResourceSize > 0 {
		// Inline: the pixels follow the header and the tag data, one image after another,
		// each its full mip chain (mip 0 first, tight rows). The offset of image i is the
		// cumulative weight of the larger images.
		flat := f.Donnees(data)
		off := 0
		for i := range all {
			a.payloads = append(a.payloads, flat[off:])
			off += mipChainSize(fm, all[i].W, all[i].H)
		}
		return nil
	}
	// Resource-backed: each image owns its resource (rank pairing, the pairing the old
	// arithmetic check confirmed). The payload of image i is the i-th resource's bytes
	// past its own header — that image's mip chain, mip 0 first.
	res, err := m.Ressources(f)
	if err != nil {
		return err
	}
	for i := range all {
		if i >= len(res) {
			break
		}
		octets, err := m.Extract(res[i])
		if err != nil {
			return err
		}
		a.payloads = append(a.payloads, res[i].Donnees(octets))
	}
	return nil
}

// mipChainSize is the total byte weight of an image's stored mip chain (mip 0 down to 1x1),
// tight rows.
func mipChainSize(fm bitmapdecode.Format, w, h int) int {
	total := 0
	for lvl := 0; lvl < 14; lvl++ {
		total += fm.LevelSize(w, h)
		if w == 1 && h == 1 {
			break
		}
		w, h = max1(w/2), max1(h/2)
	}
	return total
}

// bitmHdr describes the `bitm` bitmap block of a tag body: the record array's
// offset (in the body), its first record's dimensions and format, and the record count.
// The block is reached through the tag's own tables, exactly as himap's bitmap reader
// reaches it (the `bitmaps` block at 0xD4 of the root block).
type bitmHdr struct {
	off, w, h, format, count int
}

// bitmOffBitmaps is the offset of the `bitmaps` block field in the root block, the way
// himap's bitmap reader reaches it (a fixed child-block field, not a scan).
const bitmOffBitmaps = 0xD4

func readBitmHdr(tag []byte) (bitmHdr, error) {
	wt, err := openWeapTag(tag)
	if err != nil {
		return bitmHdr{}, err
	}
	root, err := wt.rootBlock()
	if err != nil {
		return bitmHdr{}, err
	}
	blk := wt.childBlock(root, bitmOffBitmaps)
	if blk < 0 {
		return bitmHdr{}, fmt.Errorf("bitm: the bitmaps block is not in the tag")
	}
	a, s := wt.blockAbs(blk)
	if a < 0 || s < 40 || a+s > len(tag) {
		return bitmHdr{}, fmt.Errorf("bitm: the bitmaps block is out of bounds")
	}
	return bitmHdr{
		off:    a,
		w:      int(binary.LittleEndian.Uint16(tag[a:])),
		h:      int(binary.LittleEndian.Uint16(tag[a+2:])),
		format: int(binary.LittleEndian.Uint16(tag[a+8:])),
		count:  s / 40,
	}, nil
}

// atlasImageInfo returns the descriptor, the bytes of image idx (its mip chain, mip 0
// first) and the image's format.
func atlasImageInfo(ix *tagIndex, id uint32, idx int) (im bitmImg, px []byte, fm bitmapdecode.Format, ok bool) {
	a, err := atlasOf(ix, id)
	if err != nil || idx < 0 || idx >= len(a.imgs) || idx >= len(a.payloads) {
		return bitmImg{}, nil, bitmapdecode.Format{}, false
	}
	return a.imgs[idx], a.payloads[idx], a.fm, true
}
