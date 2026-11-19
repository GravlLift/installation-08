// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import (
	"bytes"
	"encoding/binary"
	"math"
	"strings"
	"testing"
)

// buildSyntheticTag builds a tiny `ucsh` tag by hand: a root block with one real, one
// StringID and a `_40` block field, plus a child block of two reals. No game install needed.
func buildSyntheticTag() []byte {
	const hdr = 0x50
	tag := make([]byte, 212)
	binary.LittleEndian.PutUint32(tag[0:], tagMagicUCSH)
	binary.LittleEndian.PutUint32(tag[0x18:], 0) // DepCount
	binary.LittleEndian.PutUint32(tag[0x1c:], 2) // BlockCount
	binary.LittleEndian.PutUint32(tag[0x20:], 2) // StructCount
	binary.LittleEndian.PutUint32(tag[0x24:], 0) // DataRefCnt
	binary.LittleEndian.PutUint32(tag[0x28:], 0) // TagRefCnt
	binary.LittleEndian.PutUint32(tag[0x38:], hdr)

	blockTab := hdr
	// block 0: size 28, abs 176; block 1: size 8, abs 204
	binary.LittleEndian.PutUint32(tag[blockTab:], 28)
	binary.LittleEndian.PutUint64(tag[blockTab+8:], 176)
	binary.LittleEndian.PutUint32(tag[blockTab+0x10:], 8)
	binary.LittleEndian.PutUint64(tag[blockTab+0x10+8:], 204)

	structTab := blockTab + 2*0x10
	// struct 0 (MainStruct) on block 0: type 0 at +0x10, block index 0 at +0x14 (zeroed)
	// struct 1 (TagBlock): target block 1, owner block 0, field offset 8
	s := structTab + 0x20
	binary.LittleEndian.PutUint16(tag[s+0x10:], 1)
	binary.LittleEndian.PutUint32(tag[s+0x14:], 1)
	binary.LittleEndian.PutUint32(tag[s+0x18:], 0)
	binary.LittleEndian.PutUint32(tag[s+0x1C:], 8)

	// root block at 176: real, string id, then the 20-byte block field (count field at +0x10)
	binary.LittleEndian.PutUint32(tag[176:], math.Float32bits(2.5))
	binary.LittleEndian.PutUint32(tag[180:], 0x12345678)
	binary.LittleEndian.PutUint32(tag[200:], 2)
	// child block at 204: two reals
	binary.LittleEndian.PutUint32(tag[204:], math.Float32bits(1.0))
	binary.LittleEndian.PutUint32(tag[208:], math.Float32bits(3.0))
	return tag
}

func TestDumpTag(t *testing.T) {
	plugin := []byte(`<?xml version="1.0"?>
<root>
	<_14 v="a real" />
	<_2 v="a string id" />
	<_40 v="a block">
		<_14 v="a value" />
	</_40>
</root>`)

	tag := buildSyntheticTag()
	names := map[uint32]string{0x12345678: "hello"}
	groupOf := func(uint32) string { return "weap" }

	var buf bytes.Buffer
	if err := DumpTag(&buf, tag, plugin, names, groupOf); err != nil {
		t.Fatalf("DumpTag: %v", err)
	}
	got := buf.String()
	lines := strings.Split(strings.TrimRight(got, "\n"), "\n")
	want := []string{
		"root block 0: live 28 bytes, plugin 28 bytes",
		"a real = 2.5",
		`a string id = 0x12345678 "hello"`,
		"a block [2] (count field 2)",
		"a block[0]",
		"\ta value = 1",
		"a block[1]",
		"\ta value = 3",
	}
	for i, w := range want {
		if i >= len(lines) {
			t.Fatalf("missing line %d (got %d lines):\n%s", i, len(lines), got)
		}
		if lines[i] != w {
			t.Errorf("line %d:\n got:  %q\n want: %q", i, lines[i], w)
		}
	}
}
