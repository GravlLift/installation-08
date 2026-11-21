// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import (
	"encoding/binary"
	"fmt"
	"math"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
)

// The pad navpoint (`nvpt` 259f5148) draws, besides the item's own icon, a hex badge: a filled
// hex (element 40892f58), a hex outline (4bb253ec) and a type glyph (46fdf7eb), all frames of the
// sprite `bitm` 2ad12429, and an off-screen arrow (rotated element daf20cc5, `bitm` 32806c27).
// Its state group aee013ea picks what shows: state 3d319069 fades the item icon out and the hex
// outline in (the badge alone, as rack weapons show in the game), state "power" shows both. Its
// state group 50243293 sets the glyph's frame by the item's type: each state ("weapon",
// "equipment", ...) plays an image animation of `uiag` ad26179b whose keyframe block (record
// +0x58) holds (time, frame).
const (
	navpointTag      = 0x259f5148
	navpointSprite   = 0x2ad12429
	navpointArrowBmp = 0x32806c27
	navpointAnims    = 0xad26179b

	elHexFill    = 0x40892f58
	elHexOutline = 0x4bb253ec
	elGlyph      = 0x46fdf7eb
	elArrow      = 0xdaf20cc5

	navElementSize   = 0x5c
	navRotatedSize   = 0x64
	navGroupSize     = 0xa8
	navGroupImages   = 0x58
	navGroupRotated  = 0x6c
	navStateGroups   = 0x58
	navStateGroupSz  = 0x18
	navStateSize     = 0x54
	navImageTimeline = 0x2c
	navTimelineSize  = 0x38
	navTimelineAnim  = 0x20
	animRecordSize   = 0x94
	animKeyframes    = 0x58
)

// NavpointSprite is one element of the hex badge: its frame of its sprite and its size in the
// navpoint's UI units (a 2160-unit screen).
type NavpointSprite struct {
	Frame  int     `json:"frame"`
	Width  float32 `json:"width"`
	Height float32 `json:"height"`
	// File is the served image of that frame, in the HUD set.
	File string `json:"file"`
}

// NavpointBadge is the pad navpoint's hex badge, read from the game.
type NavpointBadge struct {
	Fill    NavpointSprite `json:"fill"`
	Outline NavpointSprite `json:"outline"`
	// Glyphs maps an item type ("weapon", "equipment") to its glyph frame.
	Glyphs map[string]NavpointSprite `json:"glyphs"`
	// Arrow is drawn off screen only, turned toward the item.
	Arrow NavpointSprite `json:"arrow"`
}

// buildNavpointBadge reads the badge and writes each of its frames as a PNG in the HUD set.
func buildNavpointBadge(ix *tagIndex, navpoint []byte, out string) (NavpointBadge, int, int, error) {
	ref, ok := pickRef(ix.byID[navpointAnims])
	if !ok {
		return NavpointBadge{}, 0, 0, fmt.Errorf("navpoint animations %08x not found", navpointAnims)
	}
	anims, err := ix.extract(ref)
	if err != nil {
		return NavpointBadge{}, 0, 0, err
	}
	b, err := ReadNavpointBadge(navpoint, anims)
	if err != nil {
		return b, 0, 0, err
	}
	frame := func(bitmap uint32, s *NavpointSprite, file string) (int, int, error) {
		r, ok := pickRef(ix.byID[bitmap])
		if !ok {
			return 0, 0, fmt.Errorf("navpoint bitmap %08x not found", bitmap)
		}
		m, err := ix.open(r.Module)
		if err != nil {
			return 0, 0, err
		}
		f, ok := ix.byEntry[r.Module][r.Entry]
		if !ok {
			return 0, 0, fmt.Errorf("navpoint bitmap %08x: entry %d out of range", bitmap, r.Entry)
		}
		src, err := decodeBitmapLayer(m, f, s.Frame)
		if err != nil {
			return 0, 0, fmt.Errorf("navpoint bitmap %08x frame %d: %w", bitmap, s.Frame, err)
		}
		// The old reader scaled the frame down under 128 (a cote, never up): the true layers
		// are 96 and 116 wide, so they pass through at their own size.
		img := fitDown(src, 128)
		s.File = file
		return writeHudFile(out, file, img)
	}
	files, bytes := 0, 0
	add := func(n, by int, err error) error {
		files += n
		bytes += by
		return err
	}
	if err := add(frame(navpointSprite, &b.Fill, "NavpointFill.png")); err != nil {
		return b, 0, 0, err
	}
	if err := add(frame(navpointSprite, &b.Outline, "NavpointOutline.png")); err != nil {
		return b, 0, 0, err
	}
	if err := add(frame(navpointArrowBmp, &b.Arrow, "NavpointArrow.png")); err != nil {
		return b, 0, 0, err
	}
	for typ, s := range b.Glyphs {
		file := "NavpointGlyph-" + typ + ".png"
		if err := add(frame(navpointSprite, &s, file)); err != nil {
			return b, 0, 0, err
		}
		b.Glyphs[typ] = s
	}
	return b, files, bytes, nil
}

// navElement finds the element named `name` in a block of elements of `stride` bytes.
func navElement(tag []byte, abs, size, stride int, name uint32) (int, bool) {
	for x := abs; x+stride <= abs+size; x += stride {
		if binary.LittleEndian.Uint32(tag[x:]) == name {
			return x, true
		}
	}
	return 0, false
}

// ReadNavpointBadge reads the hex badge's elements from the navpoint tag and the glyph frames of
// the item types from its animation group tag.
func ReadNavpointBadge(tag, anims []byte) (NavpointBadge, error) {
	var b NavpointBadge
	w, err := openWeapTag(tag)
	if err != nil {
		return b, err
	}
	root, err := w.rootBlock()
	if err != nil {
		return b, err
	}
	u := func(i int) uint32 { return binary.LittleEndian.Uint32(tag[i:]) }
	f := func(i int) float32 { return math.Float32frombits(u(i)) }
	sprite := func(x int) NavpointSprite {
		return NavpointSprite{Frame: int(int32(u(x + 0x58))), Width: f(x + 0x10), Height: f(x + 0x14)}
	}
	groups := w.childBlock(root, 0x44)
	_, gs := w.blockAbs(groups)
	var glyph NavpointSprite
	found := 0
	for g := 0; g*navGroupSize < gs; g++ {
		ia, is := w.blockAbs(w.childBlock(groups, g*navGroupSize+navGroupImages))
		if ia >= 0 {
			for name, dst := range map[uint32]*NavpointSprite{elHexFill: &b.Fill, elHexOutline: &b.Outline, elGlyph: &glyph} {
				if x, ok := navElement(tag, ia, is, navElementSize, name); ok && u(x+0x3c+8) == navpointSprite {
					*dst = sprite(x)
					found++
				}
			}
		}
		ra, rs := w.blockAbs(w.childBlock(groups, g*navGroupSize+navGroupRotated))
		if ra >= 0 {
			if x, ok := navElement(tag, ra, rs, navRotatedSize, elArrow); ok && u(x+0x3c+8) == navpointArrowBmp {
				b.Arrow = sprite(x)
				found++
			}
		}
	}
	if found != 4 {
		return b, fmt.Errorf("navpoint badge: %d of 4 elements found", found)
	}

	// The type states: the image animation each plays on the glyph.
	animOf := map[string]uint32{}
	sg := w.childBlock(root, navStateGroups)
	_, ss := w.blockAbs(sg)
	for g := 0; g*navStateGroupSz < ss; g++ {
		vs := w.childBlock(sg, g*navStateGroupSz+4)
		va, vsz := w.blockAbs(vs)
		for v := 0; va >= 0 && v*navStateSize < vsz; v++ {
			state := u(va + v*navStateSize)
			tl := w.childBlock(vs, v*navStateSize+navImageTimeline)
			ta, tsz := w.blockAbs(tl)
			for k := 0; ta >= 0 && k*navTimelineSize < tsz; k++ {
				for _, typ := range []string{"weapon", "equipment"} {
					if state == announcer.StringID(typ) {
						animOf[typ] = u(ta + k*navTimelineSize + navTimelineAnim)
					}
				}
			}
		}
	}
	aw, err := openWeapTag(anims)
	if err != nil {
		return b, err
	}
	b.Glyphs = map[string]NavpointSprite{}
	for typ, anim := range animOf {
		for blk := 0; blk < aw.blocks; blk++ {
			ab, asz := aw.blockAbs(blk)
			if ab < 0 || asz%animRecordSize != 0 || asz == 0 {
				continue
			}
			for k := 0; k*animRecordSize < asz; k++ {
				if binary.LittleEndian.Uint32(anims[ab+k*animRecordSize:]) != anim {
					continue
				}
				ka, ks := aw.blockAbs(aw.childBlock(blk, k*animRecordSize+animKeyframes))
				if ka < 0 || ks != 8 {
					continue
				}
				s := glyph
				s.Frame = int(binary.LittleEndian.Uint32(anims[ka+4:]))
				b.Glyphs[typ] = s
			}
		}
	}
	if len(b.Glyphs) != 2 {
		return b, fmt.Errorf("navpoint badge: glyph frames for %d of 2 types", len(b.Glyphs))
	}
	return b, nil
}
