// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package announcer extracts the Halo Infinite multiplayer announcer's voice lines from the
// user's game install: it finds the announcer's dialogue tag (`udlg`), names its vocalizations,
// follows each to its sound tag (`snd!`), its Wwise event and the media that event plays, then
// reads the media from the language's file packages and has it decoded.
package announcer

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// Tag is a parsed Infinite tag file (magic `ucsh`): its dependency list and the tables that
// locate its data blocks, the parent of each block, and its tag references.
type Tag struct {
	raw        []byte
	headerSize int
	Deps       []TagDep
	Blocks     []TagBlock
	Structs    []TagStruct
	Refs       []TagRef
}

// TagDep is a tag this tag references: its group (fourCC, e.g. "snd!") and its global id.
type TagDep struct {
	Group    string
	GlobalID uint32
}

// TagBlock is a data block: its size, its section (0 header, 1 tag data, 2 resource) and its
// offset inside that section.
type TagBlock struct {
	Size, Section, Offset int
}

// TagStruct says which data block (Target) the field at (FieldBlock, FieldOffset) points to.
type TagStruct struct {
	Type, Target, FieldBlock, FieldOffset int
}

// TagRef is a tag reference field at (FieldBlock, FieldOffset), naming dependency Dep.
type TagRef struct {
	FieldBlock, FieldOffset, Dep int
}

// Header layout of a tag file.
const (
	tagMagic        = 0x68736375 // "ucsh"
	tagHeaderFixed  = 0x50
	tagDepSize      = 0x18
	tagBlockSize    = 0x10
	tagStructSize   = 0x20
	tagDataRefSize  = 0x14
	tagRefSize      = 0x10
	tagOffDeps      = 0x18
	tagOffHeaderLen = 0x38
)

// ParseTag reads the tables of an extracted tag file.
func ParseTag(b []byte) (*Tag, error) {
	if len(b) < tagHeaderFixed || binary.LittleEndian.Uint32(b) != tagMagic {
		return nil, errors.New("announcer: not a tag file")
	}
	le := binary.LittleEndian
	counts := make([]int, 5)
	for i := range counts {
		counts[i] = int(le.Uint32(b[tagOffDeps+4*i:]))
	}
	t := &Tag{raw: b, headerSize: int(le.Uint32(b[tagOffHeaderLen:]))}
	need := tagHeaderFixed + counts[0]*tagDepSize + counts[1]*tagBlockSize + counts[2]*tagStructSize +
		counts[3]*tagDataRefSize + counts[4]*tagRefSize
	if need > len(b) || t.headerSize > len(b) {
		return nil, fmt.Errorf("announcer: tag tables overflow the file (%d > %d)", need, len(b))
	}
	o := tagHeaderFixed
	for i := 0; i < counts[0]; i++ {
		g := le.Uint32(b[o:])
		t.Deps = append(t.Deps, TagDep{Group: string([]byte{byte(g >> 24), byte(g >> 16), byte(g >> 8), byte(g)}), GlobalID: le.Uint32(b[o+0x10:])})
		o += tagDepSize
	}
	for i := 0; i < counts[1]; i++ {
		t.Blocks = append(t.Blocks, TagBlock{Size: int(le.Uint32(b[o:])), Section: int(le.Uint16(b[o+6:])), Offset: int(le.Uint64(b[o+8:]))})
		o += tagBlockSize
	}
	for i := 0; i < counts[2]; i++ {
		t.Structs = append(t.Structs, TagStruct{
			Type: int(le.Uint16(b[o+16:])), Target: int(int32(le.Uint32(b[o+20:]))),
			FieldBlock: int(int32(le.Uint32(b[o+24:]))), FieldOffset: int(le.Uint32(b[o+28:])),
		})
		o += tagStructSize
	}
	o += counts[3] * tagDataRefSize
	for i := 0; i < counts[4]; i++ {
		t.Refs = append(t.Refs, TagRef{FieldBlock: int(int32(le.Uint32(b[o:]))), FieldOffset: int(le.Uint32(b[o+4:])), Dep: int(int32(le.Uint32(b[o+12:])))})
		o += tagRefSize
	}
	return t, nil
}

// Block returns the bytes of data block i, or nil when it lies outside the tag data.
func (t *Tag) Block(i int) []byte {
	if i < 0 || i >= len(t.Blocks) {
		return nil
	}
	bl := t.Blocks[i]
	base := 0
	if bl.Section == 1 {
		base = t.headerSize
	} else if bl.Section != 0 {
		return nil
	}
	start := base + bl.Offset
	if start < 0 || start+bl.Size > len(t.raw) {
		return nil
	}
	return t.raw[start : start+bl.Size]
}

// TagData returns the tag data section (after the header).
func (t *Tag) TagData() []byte {
	return t.raw[t.headerSize:]
}
