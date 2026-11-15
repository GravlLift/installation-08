// Tag struct reader, piece 2 of the Ekur port. Translated from infinite-rs (Surasia;
// Unlicense OR MIT):
//
//	tag/header.rs                the fixed header layout
//	tag/datablock.rs             the data-block table entry and its section offset
//	tag/structure.rs             the struct-table entry
//	tag/types/common_types.rs    the FieldBlock / FieldReference field layouts
//	module/file.rs               how the main struct and its blocks are located
//
// A tag file is a fixed header, then the dependency / data-block / struct / reference
// tables, then the tag data, resource data and external resource. The struct table links
// a field (parent data block + absolute offset inside it) to a child data block; that is
// how a tag-block field is resolved to its elements. This reader walks that structure so
// later pieces can read individual fields ("the tag reference at +0x00 of element 0 of
// the block at +0x74") without a second program.
//
// It is deliberately generic: it knows the tables and a handful of field encodings
// (scalars, string id, tag reference) but not any tag's layout. Every read is
// bounds-checked and returns an error (or ok=false) rather than panicking on bad input.
package ekurport

import (
	"encoding/binary"
	"fmt"
	"math"
)

const (
	headerMagic   = uint32(0x68736375) // "ucsh"
	headerVersion = int32(27)
	headerSize    = 80 // fixed header byte size (see tag/header.rs read order)

	blockEntryBytes  = 16 // one data-block table entry
	structEntryBytes = 32 // one struct-table entry
	depEntryBytes    = 24 // one dependency table entry

	sectionTagData        = 1
	sectionResource       = 2
	sectionActualResource = 3

	structMain  = 0
	structBlock = 1
)

// Tag is a parsed view of one tag file's header and tables. It borrows the caller's bytes
// (no copy); every read is bounds-checked against that slice.
type Tag struct {
	b            []byte
	blockCount   uint32
	structCount  uint32
	resourceSize uint32
	headerSize   int // byte size of the header; tag-data section starts here
	blockTab     int
	structTab    int
	structs      []tagStruct
	tagDataSize  int // sum of every TagData block's entry size (resource-section base)
}

// tagStruct is one entry of the tag struct table. The 16-byte guid that precedes the
// stored fields is not kept: the main struct is identified by its type, and every other
// lookup keys on (field block, field offset).
type tagStruct struct {
	structType  uint16
	targetIndex int32
	fieldBlock  int32
	fieldOffset uint32
}

// ParseTag parses the header and tables of a tag file. It errors on a truncated buffer, a
// mismatched header, or tables that run past the end; it never panics on bad input.
func ParseTag(b []byte) (*Tag, error) {
	if len(b) < headerSize {
		return nil, fmt.Errorf("ekurport: tag too short (%d bytes)", len(b))
	}
	le := binary.LittleEndian
	if magic := le.Uint32(b[0:4]); magic != headerMagic {
		return nil, fmt.Errorf("ekurport: bad magic 0x%x, want 0x%x", magic, headerMagic)
	}
	if version := int32(le.Uint32(b[4:8])); version != headerVersion {
		return nil, fmt.Errorf("ekurport: bad version %d, want %d", version, headerVersion)
	}
	depCount := le.Uint32(b[24:28])
	blockCount := le.Uint32(b[28:32])
	structCount := le.Uint32(b[32:36])

	blockTab := headerSize + int(depCount)*depEntryBytes
	structTab := blockTab + int(blockCount)*blockEntryBytes
	structEnd := structTab + int(structCount)*structEntryBytes
	if structEnd > len(b) {
		return nil, fmt.Errorf("ekurport: tables exceed tag end (end %d > %d)", structEnd, len(b))
	}

	t := &Tag{
		b:            b,
		blockCount:   blockCount,
		structCount:  structCount,
		resourceSize: le.Uint32(b[64:68]),
		headerSize:   int(le.Uint32(b[56:60])),
		blockTab:     blockTab,
		structTab:    structTab,
		structs:      make([]tagStruct, structCount),
	}
	for i := range t.structs {
		e := structTab + i*structEntryBytes
		t.structs[i] = tagStruct{
			structType:  le.Uint16(b[e+16 : e+18]),
			targetIndex: int32(le.Uint32(b[e+20 : e+24])),
			fieldBlock:  int32(le.Uint32(b[e+24 : e+28])),
			fieldOffset: le.Uint32(b[e+28 : e+32]),
		}
	}
	for i := uint32(0); i < blockCount; i++ {
		size, section, _ := t.blockEntry(i)
		if section == sectionTagData {
			t.tagDataSize += size
		}
	}
	return t, nil
}

// blockEntry returns one data-block table entry's (entry size, section, raw offset). The
// entry layout is u32 size, u16 unknown (0), u16 section, u64 offset. The caller must
// have checked i is in range (blockRange does this).
func (t *Tag) blockEntry(i uint32) (size int, section uint16, offset uint64) {
	le := binary.LittleEndian
	e := t.blockTab + int(i)*blockEntryBytes
	return int(le.Uint32(t.b[e : e+4])), le.Uint16(t.b[e+6 : e+8]), le.Uint64(t.b[e+8 : e+16])
}

// blockRange returns the [abs, end) file byte range of data block i, with the
// resource-section adjustment applied.
func (t *Tag) blockRange(i uint32) (abs, end int, err error) {
	if i >= t.blockCount {
		return 0, 0, fmt.Errorf("ekurport: data block %d out of range (have %d)", i, t.blockCount)
	}
	size, section, offset := t.blockEntry(i)
	abs = int(offset) + t.sectionBase(section)
	end = abs + size
	if abs < 0 || end > len(t.b) {
		return 0, 0, fmt.Errorf("ekurport: data block %d range [%d,%d) out of bounds (tag %d bytes)", i, abs, end, len(t.b))
	}
	return abs, end, nil
}

// sectionBase is the file offset at which a data block's bytes begin, given its section.
// Block offsets in the table are relative to the start of their section, not the file.
// The tag-data section starts at headerSize; the resource section follows it (sized as the
// SUM of every TagData block's entry size, per infinite-rs common_types.rs
// FieldBlock::load_blocks, not the header's data_size which is what himap adds);
// ActualResource follows the resource data. Header blocks sit at their raw file offset.
func (t *Tag) sectionBase(section uint16) int {
	switch section {
	case sectionTagData:
		return t.headerSize
	case sectionResource:
		return t.headerSize + t.tagDataSize
	case sectionActualResource:
		return t.headerSize + t.tagDataSize + int(t.resourceSize)
	default: // Header and unknown sections
		return 0
	}
}

// Root returns the tag's main struct, the struct-table entry of type MainStruct. Its data
// begins at byte 0 of its data block.
func (t *Tag) Root() (Struct, error) {
	for _, s := range t.structs {
		if s.structType == structMain {
			if s.targetIndex < 0 || s.targetIndex >= int32(t.blockCount) {
				return Struct{}, fmt.Errorf("ekurport: main struct block %d out of range", s.targetIndex)
			}
			return Struct{tag: t, block: uint32(s.targetIndex)}, nil
		}
	}
	return Struct{}, fmt.Errorf("ekurport: no main struct in tag")
}

// Struct is a view of one struct instance: which data block it lives in and the byte
// offset of its first field within that block. Typed reads are offset relative to the
// struct and bounds-checked against the block.
type Struct struct {
	tag   *Tag
	block uint32
	off   int
}

// fieldStart returns the absolute file offset of a read of n bytes at field offset off
// (relative to the struct), and an error if it would read past the block's end. A zero
// Struct (e.g. from Block.At on an out-of-range index) yields an error, never a panic.
func (s Struct) fieldStart(off, n int) (int, error) {
	if s.tag == nil {
		return 0, fmt.Errorf("ekurport: read on an empty struct")
	}
	abs, end, err := s.tag.blockRange(s.block)
	if err != nil {
		return 0, err
	}
	if off < 0 || n < 0 {
		return 0, fmt.Errorf("ekurport: bad read (off=%d, n=%d)", off, n)
	}
	start := abs + s.off + off
	if start+n > end {
		return 0, fmt.Errorf("ekurport: read at offset %d (n=%d) past block end %d", off, n, end-abs)
	}
	return start, nil
}

// U8 reads an unsigned byte at field offset off.
func (s Struct) U8(off int) (uint8, error) {
	p, err := s.fieldStart(off, 1)
	if err != nil {
		return 0, err
	}
	return s.tag.b[p], nil
}

// I16 reads a signed 16-bit integer at field offset off.
func (s Struct) I16(off int) (int16, error) {
	p, err := s.fieldStart(off, 2)
	if err != nil {
		return 0, err
	}
	return int16(binary.LittleEndian.Uint16(s.tag.b[p:])), nil
}

// U16 reads an unsigned 16-bit integer at field offset off.
func (s Struct) U16(off int) (uint16, error) {
	p, err := s.fieldStart(off, 2)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint16(s.tag.b[p:]), nil
}

// I32 reads a signed 32-bit integer at field offset off.
func (s Struct) I32(off int) (int32, error) {
	p, err := s.fieldStart(off, 4)
	if err != nil {
		return 0, err
	}
	return int32(binary.LittleEndian.Uint32(s.tag.b[p:])), nil
}

// U32 reads an unsigned 32-bit integer at field offset off.
func (s Struct) U32(off int) (uint32, error) {
	p, err := s.fieldStart(off, 4)
	if err != nil {
		return 0, err
	}
	return binary.LittleEndian.Uint32(s.tag.b[p:]), nil
}

// F32 reads an IEEE 754 single at field offset off.
func (s Struct) F32(off int) (float32, error) {
	p, err := s.fieldStart(off, 4)
	if err != nil {
		return 0, err
	}
	return math.Float32frombits(binary.LittleEndian.Uint32(s.tag.b[p:])), nil
}

// StringID reads the 32-bit string id at field offset off. It is a Murmur3 hash; tooling
// and the string table write it as a signed decimal, so callers cast to int32 for that.
func (s Struct) StringID(off int) (uint32, error) {
	return s.U32(off)
}

// Bytes returns n bytes at field offset off, bounds-checked against the block.
func (s Struct) Bytes(off, n int) ([]byte, error) {
	p, err := s.fieldStart(off, n)
	if err != nil {
		return nil, err
	}
	return s.tag.b[p : p+n], nil
}

// TagRef reads a tag reference field at offset off. The field is laid out (common_types.rs
// FieldReference) as a u64 type pointer, the signed global id, a u64 asset id, a 4-byte
// group (stored reversed in the file), and a local handle. A null reference has global id
// -1; TagRef reports ok=false for it, and also for an out-of-bounds read.
func (s Struct) TagRef(off int) (globalID int32, group string, ok bool) {
	p, err := s.fieldStart(off, 28)
	if err != nil {
		return 0, "", false
	}
	b := s.tag.b[p:]
	globalID = int32(binary.LittleEndian.Uint32(b[8:12]))
	if globalID == -1 {
		return globalID, "", false
	}
	groupBytes := [4]byte{b[23], b[22], b[21], b[20]}
	group = string(groupBytes[:])
	return globalID, group, true
}

// Block is a resolved tag-block field: the child data block it points to and the byte
// size of one element in it. An empty block (struct-table entry with target index -1)
// resolves to a Block with empty set: Len is 0 and At returns empty structs.
type Block struct {
	tag    *Tag
	block  uint32
	stride int // byte size of one element, from the element type's definition
	empty  bool
}

// Block resolves the tag-block field at offset off to its child data block. elemStride is
// the byte size of one element (the element type's size, e.g. 0x88 for a
// CoatingIntentionDefinition); Len and At use it to walk the child block. The child block
// is found in the struct table by matching the parent block AND the field's absolute
// offset inside it, so element i of an outer block resolves its own child.
//
// The element count is not stored in the tag: on real tags the u32 at off+0x10 (the
// FieldBlock "size") is a header field that happens to sit there, not the count. The
// count is the child block's byte size divided by elemStride. An empty field (struct-
// table target index -1) resolves to a Block with Len 0.
func (s Struct) Block(off, elemStride int) (Block, error) {
	absOff := s.off + off
	var child int32 = -2 // -2 means no struct-table entry at this field at all
	for _, st := range s.tag.structs {
		if st.structType == structBlock && st.fieldBlock == int32(s.block) && int(st.fieldOffset) == absOff {
			child = st.targetIndex
			break
		}
	}
	if child == -2 {
		return Block{}, fmt.Errorf("ekurport: no tag-block struct for block %d at offset 0x%x", s.block, absOff)
	}
	if child == -1 { // null block pointer: the field holds no elements
		return Block{tag: s.tag, stride: elemStride, empty: true}, nil
	}
	return Block{tag: s.tag, block: uint32(child), stride: elemStride}, nil
}

// Len returns the element count of the block (child block byte size / element stride); 0
// when the stride is 0.
func (b Block) Len() int {
	if b.stride == 0 || b.empty {
		return 0
	}
	abs, end, err := b.tag.blockRange(b.block)
	if err != nil {
		return 0
	}
	return (end - abs) / b.stride
}

// Stride returns the byte size of one element.
func (b Block) Stride() int { return b.stride }

// At returns element i as a Struct view at offset i*Stride() in the child block. A
// negative i returns an empty struct whose reads fail.
func (b Block) At(i int) Struct {
	if i < 0 || b.empty {
		return Struct{}
	}
	return Struct{tag: b.tag, block: b.block, off: i * b.stride}
}
