// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// weapui.go — THE WEAPON-TO-ICON LINK, read from the game and self-validated.
//
// Reads the `UI display info` of a `weap` tag to get the pair (sprite = atlas bitmap,
// sprite index = the icon's position in that atlas).
//
// The offsets of the block's fields come from the layout table (weaplayout.go). The
// field-walker below (walkFields) reads a layout description passed in at run time; it serves
// the tag dumper (tagdump.go), whose descriptions stay outside the repository.
//
// PAIRING BY RANK WAS TRIED AND DISCARDED. Aligning the k-th `_40` of the plugin with the
// k-th TagBlock of the tag gives a block OFF BY ONE: the block found carried
// mode/jmad/aset references, not sprites. Correcting it with a +1 would have been a
// tweak no measurement guarantees across versions. The block is therefore identified BY
// ITS CONTENT: the one whose `sprite` field carries one of the two known atlases. That is
// self-validating — if no block matches, the probe says so instead of returning a false
// number.

package weaponicons

import (
	"encoding/binary"
	"encoding/xml"
	"fmt"
	"sort"
)

// ---------------- plugin ----------------

type xnode struct {
	XMLName xml.Name
	V       string  `xml:"v,attr"`
	Length  string  `xml:"length,attr"`
	Nodes   []xnode `xml:",any"`
}

// sizeTab: field sizes of the plugin format (group_lengths_dict), copied from the
// himap sbsp plugin — same plugin format, same table.
var sizeTab = map[string]int{
	"_0": 32, "_1": 256, "_2": 4, "_3": 4, "_4": 1, "_5": 2, "_6": 4, "_7": 8,
	"_8": 4, "_9": 4, "_A": 1, "_B": 2, "_C": 4, "_D": 4, "_E": 2, "_F": 1,
	"_10": 4, "_11": 4, "_12": 4, "_13": 4, "_14": 4, "_15": 4, "_16": 8, "_17": 12,
	"_18": 8, "_19": 12, "_1A": 16, "_1B": 8, "_1C": 12, "_1D": 12, "_1E": 16, "_1F": 12,
	"_20": 16, "_21": 4, "_22": 4, "_23": 4, "_24": 8, "_25": 8, "_26": 8, "_27": 4,
	"_28": 4, "_29": 4, "_2A": 4, "_2B": 4, "_2C": 1, "_2D": 1, "_2E": 2, "_2F": 2,
	"_30": 4, "_31": 4, "_32": 4, "_33": 4, "_36": 0, "_37": 0, "_38": 0, "_39": 32,
	"_3A": 4, "_3B": 0, "_3C": 1, "_3D": 2, "_3E": 4, "_3F": 8, "_40": 20, "_41": 28,
	"_42": 24, "_43": 16, "_44": 4, "_45": 4,
}

type pfield struct {
	name string
	// path is the name prefixed by the inline structs that hold it ("aim assist/autoaim
	// range/Base Value"); it equals name for a field at the walked level.
	path  string
	off   int
	block bool
	node  xnode
}

// walkFields walks one level of the plugin. `_38` are INLINE structs: it recurses in the
// same offset space. `_40` are arrays: their position is noted and it does NOT recurse
// (their fields live in another data block).
func walkFields(n xnode, off int, out *[]pfield) int {
	return walkFieldsIn(n, off, "", out)
}

// walkFieldsIn is walkFields with the path prefix of the inline struct being walked.
func walkFieldsIn(n xnode, off int, prefix string, out *[]pfield) int {
	for _, c := range n.Nodes {
		name := c.XMLName.Local
		switch name {
		case "_40":
			*out = append(*out, pfield{name: c.V, path: prefix + c.V, off: off, block: true, node: c})
			off += 20
		case "_38":
			off = walkFieldsIn(c, off, prefix+c.V+"/", out)
		case "Flag", "":
			// enum value / comment: not a field.
		default:
			l := sizeTab[name]
			if c.Length != "" {
				if _, err := fmt.Sscanf(c.Length, "%d", &l); err != nil {
					l = sizeTab[name]
				}
			}
			*out = append(*out, pfield{name: c.V, path: prefix + c.V, off: off, node: c})
			off += l
		}
	}
	return off
}

// ---------------- tag: tables ----------------

type weapTag struct {
	tag        []byte
	headerSize int
	blockTab   int
	structTab  int
	structs    int
	blocks     int
	// dataRefCount: the entries of the data reference table, after the struct table.
	dataRefCount int
}

func openWeapTag(tag []byte) (weapTag, error) {
	h, ok := parseTagHeader(tag)
	if !ok {
		return weapTag{}, fmt.Errorf("header not ucsh")
	}
	wt := weapTag{
		tag: tag, headerSize: int(h.HeaderSize),
		structs: int(h.StructCount), blocks: int(h.BlockCount), dataRefCount: int(h.DataRefCnt),
	}
	wt.blockTab = tagHdrFixed + int(h.DepCount)*depStride
	wt.structTab = wt.blockTab + wt.blocks*0x10
	if wt.structTab+wt.structs*0x20 > len(tag) {
		return weapTag{}, fmt.Errorf("tables out of bounds")
	}
	return wt, nil
}

func (w weapTag) blockAbs(idx int) (abs, size int) {
	b := w.blockTab + idx*0x10
	if idx < 0 || b+16 > len(w.tag) {
		return -1, 0
	}
	size = int(binary.LittleEndian.Uint32(w.tag[b:]))
	abs = int(binary.LittleEndian.Uint64(w.tag[b+8:]))
	if binary.LittleEndian.Uint16(w.tag[b+6:]) != 0 {
		abs += w.headerSize
	}
	return abs, size
}

// rootBlock: the block carried by the MainStruct (type 0).
func (w weapTag) rootBlock() (int, error) {
	for i := 0; i < w.structs; i++ {
		b := w.structTab + i*0x20
		if binary.LittleEndian.Uint16(w.tag[b+0x10:]) != 0 {
			continue
		}
		return int(int32(binary.LittleEndian.Uint32(w.tag[b+0x14:]))), nil
	}
	return 0, fmt.Errorf("MainStruct absent")
}

// tagBlocksOf returns, for a parent block, the target blocks of the TagBlocks (type 1)
// that reference it, sorted by increasing field offset.
func (w weapTag) tagBlocksOf(parent int) []int {
	type ent struct{ fo, target int }
	var ents []ent
	seen := map[int]bool{}
	for i := 0; i < w.structs; i++ {
		b := w.structTab + i*0x20
		if binary.LittleEndian.Uint16(w.tag[b+0x10:]) != 1 {
			continue
		}
		if int(int32(binary.LittleEndian.Uint32(w.tag[b+0x18:]))) != parent {
			continue
		}
		fo := int(binary.LittleEndian.Uint32(w.tag[b+0x1C:]))
		if fo < 0 || fo >= 0x10000 || seen[fo] {
			continue
		}
		seen[fo] = true
		ents = append(ents, ent{fo, int(int32(binary.LittleEndian.Uint32(w.tag[b+0x14:])))})
	}
	sort.Slice(ents, func(i, j int) bool { return ents[i].fo < ents[j].fo })
	out := make([]int, 0, len(ents))
	for _, e := range ents {
		out = append(out, e.target)
	}
	return out
}

// refGID: the tag id carried by a `_41` field (28 bytes). Position CALIBRATED on known
// references — the BR75's `mode` (a2777b87) appears at +8 from the field's start.
func refGID(tag []byte, off int) uint32 {
	if off < 0 || off+12 > len(tag) {
		return 0
	}
	return binary.LittleEndian.Uint32(tag[off+8:])
}

// findUIBlock finds the `UI display info` block BY ITS CONTENT. See the file header.
func findUIBlock(wt weapTag, data []byte, offSprite int) (abs, size int, atlas uint32, ok bool) {
	root, err := wt.rootBlock()
	if err != nil {
		return 0, 0, 0, false
	}
	for _, blk := range wt.tagBlocksOf(root) {
		a, s := wt.blockAbs(blk)
		if a < 0 || s < offSprite+28 || a+s > len(data) {
			continue
		}
		g := refGID(data, a+offSprite)
		if g == 0xbc17adf1 || g == 0xe39747c8 {
			return a, s, g, true
		}
	}
	return 0, 0, 0, false
}
