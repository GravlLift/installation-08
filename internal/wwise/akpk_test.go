package wwise

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"
)

// le32 appends little-endian u32 values.
func le32(b []byte, vs ...uint32) []byte {
	for _, v := range vs {
		b = binary.LittleEndian.AppendUint32(b, v)
	}
	return b
}

// testLanguageMap builds a two-language map with UTF-16LE names.
func testLanguageMap() []byte {
	names := []string{"sfx", "english(us)"}
	head := le32(nil, uint32(len(names)))
	strOff := 4 + 8*len(names)
	var strs []byte
	for i, n := range names {
		head = le32(head, uint32(strOff+len(strs)), uint32(i))
		for _, c := range utf16.Encode([]rune(n)) {
			strs = binary.LittleEndian.AppendUint16(strs, c)
		}
		strs = append(strs, 0, 0)
	}
	for len(strs)%4 != 0 {
		strs = append(strs, 0)
	}
	return append(head, strs...)
}

// testPackage builds a package with an empty bank table, two streamed media and one external
// source, followed by the media bytes ("AAAA", "BBBBBB", "CC"), on a 16-byte block size for the
// streams.
func testPackage() ([]byte, map[uint64][]byte) {
	langs := testLanguageMap()
	banks := le32(nil, 0)
	streams := le32(nil, 2)
	externals := le32(nil, 1)
	media := map[uint64][]byte{11: []byte("AAAA"), 22: []byte("BBBBBB"), 1 << 40: []byte("CC")}
	header := akpkHeaderSize + len(langs) + len(banks) + (4 + 2*20) + (4 + 24)
	base := (header + 15) / 16 * 16
	streams = le32(streams, 11, 16, 4, uint32(base/16), 1)
	streams = le32(streams, 22, 16, 6, uint32(base/16+1), 1)
	externals = binary.LittleEndian.AppendUint64(externals, 1<<40)
	externals = le32(externals, 1, 2, uint32(base+32), 0)
	b := []byte("AKPK")
	b = le32(b, uint32(header-8), 1, uint32(len(langs)), uint32(len(banks)), uint32(len(streams)), uint32(len(externals)))
	b = append(append(append(append(b, langs...), banks...), streams...), externals...)
	b = append(b, make([]byte, base-len(b))...)
	b = append(append(b, media[11]...), make([]byte, 12)...)
	b = append(append(b, media[22]...), make([]byte, 10)...)
	b = append(b, media[1<<40]...)
	return b, media
}

func TestParsePackageReadsTablesAndLanguages(t *testing.T) {
	raw, media := testPackage()
	path := filepath.Join(t.TempDir(), "sb_test.pck")
	if err := os.WriteFile(path, raw, 0o644); err != nil {
		t.Fatal(err)
	}
	p, err := ReadPackageFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if p.Version != 1 || p.Languages[1] != "english(us)" || p.Languages[0] != "sfx" {
		t.Fatalf("header: version %d, languages %v", p.Version, p.Languages)
	}
	if len(p.Entries) != 3 {
		t.Fatalf("entries: %+v", p.Entries)
	}
	for _, e := range p.Entries {
		got, err := p.ReadEntry(e)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(got, media[e.ID]) {
			t.Fatalf("entry %d (%s): %q, want %q", e.ID, e.Table, got, media[e.ID])
		}
	}
	if e := p.Entries[0]; e.Table != TableStreams || e.Language != "english(us)" {
		t.Fatalf("stream entry: %+v", e)
	}
	if e := p.Entries[2]; e.Table != TableExternals || e.Language != "sfx" {
		t.Fatalf("external entry: %+v", e)
	}
}

func TestParsePackageRefusesOtherFiles(t *testing.T) {
	if _, err := ParsePackage([]byte("RIFF0000WAVEfmt 000000000000")); err == nil {
		t.Fatal("a RIFF file parsed as a package")
	}
	raw, _ := testPackage()
	binary.LittleEndian.PutUint32(raw[0x10:], 1<<20)
	if _, err := ParsePackage(raw[:200]); err == nil {
		t.Fatal("a table overflowing the header parsed")
	}
}
