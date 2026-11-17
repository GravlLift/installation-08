// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package reloadsounds

import (
	"encoding/binary"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
)

// The tag file layout internal/announcer.ParseTag reads: a fixed header with the table counts
// at 0x18 and the header length at 0x38, then the dependency (0x18 B), block (0x10 B) and struct
// (0x20 B) tables; the tag data (section 1) follows the header.
const (
	testTagMagic     = 0x68736375
	testHeaderFixed  = 0x50
	testDepSize      = 0x18
	testBlockSize    = 0x10
	testStructSize   = 0x20
	testOffCounts    = 0x18
	testOffHeaderLen = 0x38
)

type testDep struct {
	group string
	id    uint32
}

// testStruct links (block, offset) to target with a struct of type typ.
type testStruct struct{ typ, target, block, offset int }

// testTag is a tag under construction: its dependencies, its data blocks (all in the tag data
// section, laid end to end) and its structs.
type testTag struct {
	deps    []testDep
	data    []byte
	blocks  [][2]int // size, offset in the tag data
	structs []testStruct
}

// block appends a data block and returns its index.
func (tt *testTag) block(b []byte) int {
	tt.blocks = append(tt.blocks, [2]int{len(b), len(tt.data)})
	tt.data = append(tt.data, b...)
	return len(tt.blocks) - 1
}

func (tt *testTag) link(typ, target, block, offset int) {
	tt.structs = append(tt.structs, testStruct{typ, target, block, offset})
}

// bytes encodes the tag file.
func (tt *testTag) bytes() []byte {
	le := binary.LittleEndian
	header := testHeaderFixed + len(tt.deps)*testDepSize + len(tt.blocks)*testBlockSize + len(tt.structs)*testStructSize
	b := make([]byte, header, header+len(tt.data))
	le.PutUint32(b, testTagMagic)
	for i, n := range []int{len(tt.deps), len(tt.blocks), len(tt.structs)} {
		le.PutUint32(b[testOffCounts+4*i:], uint32(n))
	}
	le.PutUint32(b[testOffHeaderLen:], uint32(header))
	o := testHeaderFixed
	for _, d := range tt.deps {
		le.PutUint32(b[o:], uint32(d.group[0])<<24|uint32(d.group[1])<<16|uint32(d.group[2])<<8|uint32(d.group[3]))
		le.PutUint32(b[o+0x10:], d.id)
		o += testDepSize
	}
	for _, bl := range tt.blocks {
		le.PutUint32(b[o:], uint32(bl[0]))
		le.PutUint16(b[o+6:], 1)
		le.PutUint64(b[o+8:], uint64(bl[1]))
		o += testBlockSize
	}
	for _, s := range tt.structs {
		le.PutUint16(b[o+16:], uint16(s.typ))
		le.PutUint32(b[o+20:], uint32(int32(s.target)))
		le.PutUint32(b[o+24:], uint32(int32(s.block)))
		le.PutUint32(b[o+28:], uint32(s.offset))
		o += testStructSize
	}
	return append(b, tt.data...)
}

func (tt *testTag) parse(t *testing.T) *announcer.Tag {
	t.Helper()
	tag, err := announcer.ParseTag(tt.bytes())
	if err != nil {
		t.Fatal(err)
	}
	return tag
}

// soundEntries encodes sound reference entries (96 B each) naming the given tags.
func soundEntries(ids ...uint32) []byte {
	b := make([]byte, len(ids)*soundEntryStride)
	for i, id := range ids {
		binary.LittleEndian.PutUint32(b[i*soundEntryStride+soundEntryOffTag:], id)
	}
	return b
}

// soundEvents encodes sound events (reference index, frame).
func soundEvents(pairs ...[2]int) []byte {
	var b []byte
	for _, p := range pairs {
		b = binary.LittleEndian.AppendUint16(b, uint16(int16(p[0])))
		b = binary.LittleEndian.AppendUint16(b, uint16(int16(p[1])))
		b = append(b, 0, 0, 0, 0)
	}
	return b
}
