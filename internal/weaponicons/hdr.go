// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// hdr.go — the `ucsh` header of a Halo Infinite tag file + the dependency table.
// Reduced to what the probe needs.

package weaponicons

import "encoding/binary"

type tagHeader struct {
	Magic       uint32
	Version     int32
	DepCount    int32
	BlockCount  int32
	StructCount int32
	DataRefCnt  int32
	TagRefCnt   int32
	StrTabSize  int32
	ZoneSetSize int32
	HeaderSize  int32
	DataSize    int32
	ResSize     int32
}

const (
	tagMagicUCSH = 0x68736375 // 'ucsh' little-endian
	tagHdrFixed  = 0x50
	depStride    = 0x18
)

func parseTagHeader(b []byte) (tagHeader, bool) {
	if len(b) < tagHdrFixed {
		return tagHeader{}, false
	}
	g := func(o int) int32 { return int32(binary.LittleEndian.Uint32(b[o:])) }
	h := tagHeader{
		Magic:       binary.LittleEndian.Uint32(b[0:]),
		Version:     g(0x04),
		DepCount:    g(0x18),
		BlockCount:  g(0x1c),
		StructCount: g(0x20),
		DataRefCnt:  g(0x24),
		TagRefCnt:   g(0x28),
		StrTabSize:  g(0x2c),
		ZoneSetSize: g(0x30),
		HeaderSize:  g(0x38),
		DataSize:    g(0x3c),
		ResSize:     g(0x40),
	}
	return h, h.Magic == tagMagicUCSH
}

// readU32LE reads a little-endian u32 at o, or 0 when it does not fit.
func readU32LE(b []byte, o int) uint32 {
	if o < 0 || o+4 > len(b) {
		return 0
	}
	return uint32(b[o]) | uint32(b[o+1])<<8 | uint32(b[o+2])<<16 | uint32(b[o+3])<<24
}
