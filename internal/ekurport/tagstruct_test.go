package ekurport

import (
	"encoding/binary"
	"testing"
)

// buildTestTag assembles a minimal, self-consistent tag byte slice:
//
//	header (80 bytes): magic, version 27, 0 deps, 3 blocks, 3 structs, 0 refs
//	data block 0 (main block): 0x58 bytes at file offset 0x100
//	  - string id at +0x00 = 0x11223344
//	  - tag-block field at +0x10 -> block 1, element count 2
//	  - tag-block field at +0x30 -> block 2, element count 0 (empty block)
//	data block 1 (child block): 0x38 bytes (two 28-byte tag references) at 0x160
//	  - element 0: tag reference global id 12345, group "mat "
//	  - element 1: null tag reference (global id -1)
//	data block 2 (empty): 0 bytes at 0x198
//
// Each tag-block field is 0x14 bytes (u64 type_info, u64 unknown, u32 size), so the two
// fields at +0x10 and +0x30 do not overlap.
func buildTestTag(t *testing.T) []byte {
	t.Helper()
	b := make([]byte, 0x200) // 512 bytes
	le := binary.LittleEndian
	put := func(off int, v uint32) { le.PutUint32(b[off:off+4], v) }
	put64 := func(off int, v uint64) { le.PutUint64(b[off:off+8], v) }

	// header
	put(0, headerMagic)
	put(4, uint32(headerVersion))
	put(24, 0)  // depCount
	put(28, 3)  // blockCount
	put(32, 3)  // structCount
	put(36, 0)  // dataRefCount
	put(40, 0)  // tagRefCount
	put(56, 80) // headerSize (0x50, used as tag-data section base)
	put(60, 0x200)
	put(64, 0) // resourceSize

	// data block table @80; offsets are relative to headerSize (0x50)
	put(80, 0x58) // block 0 entry_size
	le.PutUint16(b[84:86], 0)
	le.PutUint16(b[86:88], sectionTagData)
	put64(88, 0xB0) // block 0 offset (0x100 - 0x50)
	put(96, 0x38)   // block 1 entry_size
	le.PutUint16(b[100:102], 0)
	le.PutUint16(b[102:104], sectionTagData)
	put64(104, 0x110) // block 1 offset (0x160 - 0x50)
	put(112, 0)       // block 2 entry_size (empty)
	le.PutUint16(b[116:118], 0)
	le.PutUint16(b[118:120], sectionTagData)
	put64(120, 0x148) // block 2 offset (0x198 - 0x50)

	// struct table @128 (entry: guid16, type@+16, loc@+18, target@+20, fieldBlock@+24, fieldOffset@+28)
	// struct 0: MainStruct -> block 0
	le.PutUint16(b[144:146], structMain)
	put(148, 0)          // targetIndex
	put(152, 0xFFFFFFFF) // fieldBlock = -1
	put(156, 0)          // fieldOffset
	// struct 1: TagBlock -> block 1, at main block offset 0x10
	le.PutUint16(b[176:178], structBlock)
	put(180, 1)    // targetIndex
	put(184, 0)    // fieldBlock
	put(188, 0x10) // fieldOffset
	// struct 2: TagBlock -> block 2, at main block offset 0x30
	le.PutUint16(b[208:210], structBlock)
	put(212, 2)    // targetIndex
	put(216, 0)    // fieldBlock
	put(220, 0x30) // fieldOffset

	// main block data @0x100 (256)
	put(0x100, 0x11223344) // string id at +0x00
	put64(0x110, 0)        // tag-block field at +0x10: type_info
	put64(0x118, 0)        // unknown
	put(0x120, 2)          // size = 2 (at +0x20)
	put64(0x130, 0)        // tag-block field at +0x30: type_info
	put64(0x138, 0)        // unknown
	put(0x140, 0)          // size = 0 (at +0x40, empty block)

	// child block data @0x160 (352); element = 28-byte tag reference
	// element 0 @0x160 (352)
	put64(0x160, 0) // type_info
	put(0x168, 12345)
	put64(0x16C, 0) // asset_id at +12
	b[0x174] = ' '  // group at +20, stored reversed: "mat " -> [space,t,a,m]
	b[0x175] = 't'
	b[0x176] = 'a'
	b[0x177] = 'm'
	put(0x178, 0) // local handle at +24
	// element 1 @0x17C (380)
	put64(0x17C, 0)        // type_info
	put(0x184, 0xFFFFFFFF) // global_id = -1 (null reference)
	return b
}

func TestParseTagRootAndScalars(t *testing.T) {
	tag, err := ParseTag(buildTestTag(t))
	if err != nil {
		t.Fatalf("ParseTag: %v", err)
	}
	root, err := tag.Root()
	if err != nil {
		t.Fatalf("Root: %v", err)
	}
	if sid, err := root.StringID(0); err != nil || sid != 0x11223344 {
		t.Errorf("StringID(0) = %d, %v; want 0x11223344", sid, err)
	}
	// out-of-bounds reads must error, not panic
	if _, err := root.StringID(0x100); err == nil {
		t.Error("StringID(0x100): want out-of-bounds error, got nil")
	}
	if _, err := root.U8(0x58); err == nil {
		t.Error("U8(0x58): want out-of-bounds error, got nil")
	}
	if _, _, ok := root.TagRef(0x100); ok {
		t.Error("TagRef(0x100): want ok=false out of bounds, got true")
	}
}

func TestParseTagNestedBlock(t *testing.T) {
	tag, err := ParseTag(buildTestTag(t))
	if err != nil {
		t.Fatalf("ParseTag: %v", err)
	}
	root, err := tag.Root()
	if err != nil {
		t.Fatalf("Root: %v", err)
	}
	blk, err := root.Block(0x10, 28)
	if err != nil {
		t.Fatalf("Block(0x10): %v", err)
	}
	if blk.Len() != 2 {
		t.Errorf("Len() = %d, want 2", blk.Len())
	}
	if blk.Stride() != 28 {
		t.Errorf("Stride() = %d, want 28", blk.Stride())
	}
	e0, e1 := blk.At(0), blk.At(1)
	gid, group, ok := e0.TagRef(0)
	if !ok || gid != 12345 || group != "mat " {
		t.Errorf("elem0 TagRef = (%d,%q,%v), want (12345,\"mat \",true)", gid, group, ok)
	}
	gid, group, ok = e1.TagRef(0)
	if ok || gid != -1 || group != "" {
		t.Errorf("elem1 TagRef = (%d,%q,%v), want (-1,\"\",false) for null ref", gid, group, ok)
	}
	// element index out of range yields a struct whose reads fail, not a panic
	if _, err := blk.At(2).StringID(0); err == nil {
		t.Error("At(2).StringID(0): want error for out-of-range element")
	}
	// a field offset that is not a tag block
	if _, err := root.Block(0x00, 28); err == nil {
		t.Error("Block(0x00): want error (string id, not a tag block)")
	}
}

func TestParseTagEmptyBlock(t *testing.T) {
	tag, err := ParseTag(buildTestTag(t))
	if err != nil {
		t.Fatalf("ParseTag: %v", err)
	}
	root, err := tag.Root()
	if err != nil {
		t.Fatalf("Root: %v", err)
	}
	blk, err := root.Block(0x30, 28)
	if err != nil {
		t.Fatalf("Block(0x30): %v", err)
	}
	if blk.Len() != 0 || blk.Stride() != 28 {
		t.Errorf("empty block Len=%d Stride=%d, want 0,28", blk.Len(), blk.Stride())
	}
}

func TestParseTagBadInput(t *testing.T) {
	// truncated buffer
	if _, err := ParseTag(make([]byte, 10)); err == nil {
		t.Error("ParseTag(short): want error")
	}
	// bad magic
	b := buildTestTag(t)
	b[0], b[1], b[2], b[3] = 0, 0, 0, 0
	if _, err := ParseTag(b); err == nil {
		t.Error("ParseTag(bad magic): want error")
	}
	// bad version
	b = buildTestTag(t)
	binary.LittleEndian.PutUint32(b[4:8], 26)
	if _, err := ParseTag(b); err == nil {
		t.Error("ParseTag(bad version): want error")
	}
}
