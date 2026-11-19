// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import (
	"bytes"
	"encoding/binary"
	"testing"
	"unicode/utf16"
)

// testSfnt builds a minimal TrueType file: an sfnt 1.0 header with one `name` table that
// holds a Windows-platform full name (name ID 4).
func testSfnt(fullName string) []byte {
	be := binary.BigEndian
	u := utf16.Encode([]rune(fullName))
	str := make([]byte, 2*len(u))
	for i, c := range u {
		be.PutUint16(str[2*i:], c)
	}
	// name table: format 0, count 1, string offset 6+12, one record, then the string.
	name := make([]byte, 6+12)
	be.PutUint16(name[2:], 1)
	be.PutUint16(name[4:], 18)
	be.PutUint16(name[6:], 3)  // platform Windows
	be.PutUint16(name[8:], 1)  // encoding Unicode BMP
	be.PutUint16(name[10:], 0x409)
	be.PutUint16(name[12:], 4) // full name
	be.PutUint16(name[14:], uint16(len(str)))
	be.PutUint16(name[16:], 0)
	name = append(name, str...)
	f := make([]byte, 12+16)
	be.PutUint32(f[0:], 0x00010000)
	be.PutUint16(f[4:], 1)
	copy(f[12:], "name")
	be.PutUint32(f[12+8:], uint32(len(f)))
	be.PutUint32(f[12+12:], uint32(len(name)))
	return append(f, name...)
}

// testFontResource wraps a font the way the game's font resources do: a ucsh header of
// headerSize bytes, 16 filler bytes, a zero word, the font's length, the font.
func testFontResource(font []byte, headerSize int) []byte {
	le := binary.LittleEndian
	b := make([]byte, headerSize+24)
	le.PutUint32(b[0:], tagMagicUCSH)
	le.PutUint32(b[0x38:], uint32(headerSize))
	le.PutUint32(b[0x3c:], uint32(24+len(font)))
	for i := 0; i < 16; i++ {
		b[headerSize+i] = 0xbc
	}
	le.PutUint32(b[headerSize+20:], uint32(len(font)))
	return append(b, font...)
}

func TestFontFromResourceReadsTheEmbeddedTrueType(t *testing.T) {
	font := testSfnt("Normative Pro Medium")
	got, err := fontFromResource(testFontResource(font, 180))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, font) {
		t.Fatalf("font bytes differ: got %d bytes, want %d", len(got), len(font))
	}
	if name := sfntName(got, 4); name != "Normative Pro Medium" {
		t.Fatalf("full name = %q", name)
	}
	if hudFonts[sfntName(got, 4)] != "NormativePro-Medium" {
		t.Fatalf("the full name does not pick the Medium file")
	}
}

func TestFontFromResourceRefusesBadBlobs(t *testing.T) {
	font := testSfnt("Industry Demi")
	long := testFontResource(font, 180)
	binary.LittleEndian.PutUint32(long[180+20:], uint32(len(font)+1))
	if _, err := fontFromResource(long); err == nil {
		t.Fatal("a length past the end must be refused")
	}
	notSfnt := testFontResource(font, 180)
	notSfnt[180+24] = 'O'
	if _, err := fontFromResource(notSfnt); err == nil {
		t.Fatal("bytes that are not an sfnt 1.0 header must be refused")
	}
	if _, err := fontFromResource([]byte("short")); err == nil {
		t.Fatal("a blob without a ucsh header must be refused")
	}
}

func TestHudFontNamesAreTheServedFiles(t *testing.T) {
	names := HudFontNames()
	if len(names) != len(hudFonts) {
		t.Fatalf("%d names for %d faces", len(names), len(hudFonts))
	}
	found := false
	for _, n := range names {
		if n == hudFontRequired {
			found = true
		}
	}
	if !found {
		t.Fatalf("the required face %s is not among the served names %v", hudFontRequired, names)
	}
}
