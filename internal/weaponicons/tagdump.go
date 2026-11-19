// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// tagdump.go — a generic, plugin-driven tag dumper.
//
// Halo Infinite's HUD is described by data-driven UI tags. Their layout is NOT
// hardcoded here: it is read from a community layout plugin (the format of weap.xml),
// and the live tag's size is checked against the plugin's walked size on every block.
// A mismatch is reported, never trusted.
//
// The mechanics are the field-walker of weapui.go (walkFields, sizeTab) plus the tag
// tables of openWeapTag. Nothing here is tuned by eye.

package weaponicons

import (
	"bytes"
	"encoding/binary"
	"encoding/xml"
	"fmt"
	"io"
	"math"
	"sort"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

// The layout plugin is passed in by the caller, never embedded: the community layouts that
// match the installed game (Z-15/Halo-Infinite-Tag-Editor's Tag_Structures, March 2023) carry
// no license, so they stay outside the repository, in the gitignored data folder of the probe
// that reads them.

// TagReader reads any tag of the installed game by id (index built once, lazily).
type TagReader struct {
	ix *tagIndex
}

// NewTagReader builds the full tag index once.
func NewTagReader() *TagReader {
	return &TagReader{ix: buildIndex("")}
}

// IDs returns the ids of a group, sorted and deduped.
func (r *TagReader) IDs(group string) []uint32 {
	seen := map[uint32]bool{}
	var ids []uint32
	for _, ref := range r.ix.byGroup[group] {
		if !seen[ref.ID] {
			seen[ref.ID] = true
			ids = append(ids, ref.ID)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

// Group returns the group fourcc of a tag id, "" when absent.
func (r *TagReader) Group(id uint32) string {
	for _, ref := range r.ix.byID[id] {
		return ref.Group
	}
	return ""
}

// Tag returns the decompressed bytes of a tag via pickRef + extract.
func (r *TagReader) Tag(id uint32) ([]byte, error) {
	ref, ok := pickRef(r.ix.byID[id])
	if !ok {
		return nil, fmt.Errorf("tag 0x%08x not found", id)
	}
	return r.ix.extract(ref)
}

// StringIDNames returns, for every harvested string whose hash is wanted (nil wanted =
// all), the StringID -> name. Names are recovered by hashing the game binary's printable
// strings, the same recipe as names.go.
func StringIDNames(wanted map[uint32]bool) (map[uint32]string, error) {
	exe := gameBinary()
	if exe == "" {
		return nil, fmt.Errorf("game binary not found")
	}
	strs, err := harvestStrings(exe, 3)
	if err != nil {
		return nil, err
	}
	out := make(map[uint32]string)
	for s := range strs {
		for _, v := range nameVariants(s) {
			h := uint32(mapvar.LabelHash(v))
			if wanted != nil && !wanted[h] {
				continue
			}
			if _, dup := out[h]; !dup {
				out[h] = v
			}
		}
	}
	return out, nil
}

// CollectStringIDs walks a tag with the layout plugin and returns every StringID it sees,
// sorted. It is the first pass that lets a probe build the `wanted` set for StringIDNames
// before the named dump.
func CollectStringIDs(tag []byte, plugin []byte) ([]uint32, error) {
	var root xnode
	if err := xml.Unmarshal(plugin, &root); err != nil {
		return nil, err
	}
	var fields []pfield
	walkFields(root, 0, &fields)
	wt, err := openWeapTag(tag)
	if err != nil {
		return nil, err
	}
	rootBlk, err := wt.rootBlock()
	if err != nil {
		return nil, err
	}
	abs, _ := wt.blockAbs(rootBlk)
	st := &dumpState{
		w: io.Discard, wt: wt,
		groupOf: func(uint32) string { return "" },
		visited: map[int]bool{rootBlk: true},
		ids:     map[uint32]bool{},
	}
	_ = st.dumpElement(rootBlk, abs, 0, fields, "", 0)
	out := make([]uint32, 0, len(st.ids))
	for id := range st.ids {
		out = append(out, id)
	}
	sort.Slice(out, func(i, j int) bool { return out[i] < out[j] })
	return out, nil
}

// dumpState carries the shared state of one DumpTag run.
type dumpState struct {
	w       io.Writer
	wt      weapTag
	names   map[uint32]string
	groupOf func(uint32) string
	visited map[int]bool
	// ids, when non-nil, collects every StringID seen (used by CollectStringIDs).
	ids map[uint32]bool
}

const dumpDepthLimit = 12

// flagNames returns the Flag children of a node, in order (bit i = i-th flag).
func flagNames(n xnode) []string {
	var out []string
	for _, c := range n.Nodes {
		if c.XMLName.Local == "Flag" {
			out = append(out, c.V)
		}
	}
	return out
}

// isSkipped reports whether a plugin type code is padding or a comment (skipped in a dump).
func isSkipped(tc string) bool {
	switch tc {
	case "_34", "_36", "_37", "_3B":
		return true
	}
	return false
}

// fieldVal renders one scalar field's value. blk and relOff are the owning block and the
// field's offset within it (needed to resolve a `_42` data reference). It returns
// ok=false when the field runs past the end of the tag.
func (st *dumpState) fieldVal(f pfield, off, blk, relOff int) (string, bool) {
	tc := f.node.XMLName.Local
	size := sizeTab[tc]
	if off < 0 || off+size > len(st.wt.tag) {
		return "", false
	}
	b := st.wt.tag[off : off+size]
	u32 := binary.LittleEndian.Uint32
	f32 := func(v []byte) float32 { return math.Float32frombits(u32(v)) }
	switch tc {
	case "_14":
		return fmt.Sprintf("%g", f32(b)), true
	case "_16":
		return fmt.Sprintf("%g %g", f32(b), f32(b[4:])), true
	case "_17", "_1C", "_1F":
		return fmt.Sprintf("%g %g %g", f32(b), f32(b[4:]), f32(b[8:])), true
	case "_20":
		return fmt.Sprintf("a r g b = %g %g %g %g", f32(b), f32(b[4:]), f32(b[8:]), f32(b[12:])), true
	case "_6", "_3", "_8":
		return fmt.Sprintf("%d", int32(u32(b))), true
	case "_5":
		return fmt.Sprintf("%d", int16(binary.LittleEndian.Uint16(b))), true
	case "_4":
		return fmt.Sprintf("%d", int8(b[0])), true
	case "_2":
		sid := u32(b)
		if st.ids != nil {
			st.ids[sid] = true
		}
		if name, ok := st.names[sid]; ok {
			return fmt.Sprintf("0x%08x %q", sid, name), true
		}
		return fmt.Sprintf("0x%08x", sid), true
	case "_41":
		gid := refGID(st.wt.tag, off)
		if gid == 0 || gid == 0xffffffff {
			return "none", true
		}
		return fmt.Sprintf("%s 0x%08x", st.groupOf(gid), gid), true
	case "_42":
		// data reference: the bytes it points to, from the owning block's data table.
		data, ok := st.wt.dataRefs(blk)[relOff]
		if !ok {
			return "data <unresolved>", true
		}
		hex := data
		if len(hex) > 32 {
			hex = hex[:32]
		}
		return fmt.Sprintf("data %d bytes: %x", len(data), hex), true
	case "_F", "_E", "_C":
		val := st.bitVal(b)
		var set []string
		for i, name := range flagNames(f.node) {
			if val&(1<<uint(i)) != 0 {
				set = append(set, name)
			}
		}
		return fmt.Sprintf("0x%x (%s)", val, strings.Join(set, ", ")), true
	case "_A", "_B", "_D":
		val := int(st.bitVal(b))
		names := flagNames(f.node)
		label := "?"
		if val >= 0 && val < len(names) {
			label = names[val]
		}
		return fmt.Sprintf("%d %q", val, label), true
	case "_1":
		s := b
		if i := bytes.IndexByte(s, 0); i >= 0 {
			s = s[:i]
		}
		return fmt.Sprintf("%q", strings.TrimSpace(string(s))), true
	default:
		return fmt.Sprintf("%x", b), true
	}
}

// bitVal reads a bitfield value of 1, 2 or 4 bytes as an unsigned integer.
func (st *dumpState) bitVal(b []byte) uint64 {
	switch len(b) {
	case 1:
		return uint64(b[0])
	case 2:
		return uint64(binary.LittleEndian.Uint16(b))
	case 4:
		return uint64(binary.LittleEndian.Uint32(b))
	}
	return 0
}

// DumpTag writes the tag as an indented text tree, one field per line, using the layout
// plugin. It checks every block's live size against the plugin's walked size.
func DumpTag(w io.Writer, tag []byte, plugin []byte, names map[uint32]string, groupOf func(uint32) string) error {
	var root xnode
	if err := xml.Unmarshal(plugin, &root); err != nil {
		return err
	}
	var fields []pfield
	walked := walkFields(root, 0, &fields)
	wt, err := openWeapTag(tag)
	if err != nil {
		return err
	}
	rootBlk, err := wt.rootBlock()
	if err != nil {
		return err
	}
	abs, size := wt.blockAbs(rootBlk)
	if abs < 0 || abs+size > len(tag) {
		return fmt.Errorf("root block out of bounds")
	}
	st := &dumpState{w: w, wt: wt, names: names, groupOf: groupOf, visited: map[int]bool{rootBlk: true}}
	fmt.Fprintf(st.w, "root block %d: live %d bytes, plugin %d bytes\n", rootBlk, size, walked)
	return st.dumpElement(rootBlk, abs, 0, fields, "", 0)
}

// dumpElement prints the fields of one element: block blk, element at absolute offset
// elemBase, block-relative offset elemRel, walking fields with the given indent.
func (st *dumpState) dumpElement(blk, elemBase, elemRel int, fields []pfield, indent string, depth int) error {
	if depth > dumpDepthLimit {
		return nil
	}
	for _, f := range fields {
		if f.block {
			st.dumpTagBlock(blk, f, elemBase, elemRel, indent, depth)
		} else if !isSkipped(f.node.XMLName.Local) {
			st.dumpField(f, elemBase+f.off, blk, elemRel+f.off, indent)
		}
	}
	return nil
}

// dumpField prints one scalar field.
func (st *dumpState) dumpField(f pfield, off, blk, relOff int, indent string) {
	val, ok := st.fieldVal(f, off, blk, relOff)
	if !ok {
		fmt.Fprintf(st.w, "%s%s = <out of bounds>\n", indent, f.path)
		return
	}
	fmt.Fprintf(st.w, "%s%s = %s\n", indent, f.path, val)
}

// dumpTagBlock prints a `_40` tag block: the header line with the element count, then each
// element with its fields indented.
func (st *dumpState) dumpTagBlock(blk int, f pfield, elemBase, elemRel int, indent string, depth int) {
	if depth >= dumpDepthLimit {
		return
	}
	var inner []pfield
	elemSize := walkFields(f.node, 0, &inner)
	child := st.wt.childBlock(blk, elemRel+f.off)
	if child < 0 {
		fmt.Fprintf(st.w, "%s%s: no block\n", indent, f.path)
		return
	}
	if st.visited[child] {
		fmt.Fprintf(st.w, "%s%s: block %d (already visited)\n", indent, f.path, child)
		return
	}
	cabs, csize := st.wt.blockAbs(child)
	if cabs < 0 || cabs+csize > len(st.wt.tag) {
		fmt.Fprintf(st.w, "%s%s: block %d out of bounds\n", indent, f.path, child)
		return
	}
	// The u32 at +0x10 of the 20-byte block field: checks the inferred count position.
	countField := readU32LE(st.wt.tag, elemBase+f.off+0x10)
	if elemSize <= 0 {
		fmt.Fprintf(st.w, "%s%s [0] (count field %d)\n", indent, f.path, countField)
		return
	}
	count := csize / elemSize
	if csize%elemSize != 0 {
		fmt.Fprintf(st.w, "%s%s [?]: LAYOUT MISMATCH child %d bytes, element %d (count field %d)\n",
			indent, f.path, csize, elemSize, countField)
		return
	}
	fmt.Fprintf(st.w, "%s%s [%d] (count field %d)\n", indent, f.path, count, countField)
	st.visited[child] = true
	for i := 0; i < count; i++ {
		eBase := cabs + i*elemSize
		eRel := i * elemSize
		fmt.Fprintf(st.w, "%s%s[%d]\n", indent, f.path, i)
		_ = st.dumpElement(child, eBase, eRel, inner, indent+"\t", depth+1)
	}
}
