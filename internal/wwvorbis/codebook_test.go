package wwvorbis

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// bitsOf packs (value, width) pairs the way the Vorbis bitstream does.
func bitsOf(pairs ...uint32) []byte {
	var w bitWriter
	for i := 0; i+1 < len(pairs); i += 2 {
		w.write(pairs[i], uint(pairs[i+1]))
	}
	return w.bytes()
}

// testLibrary is a packed library of one codebook: 1 dimension, 2 entries, unordered, lengths
// stored on 1 bit (both 0, codewords of length 1), no lookup table. 26 bits, so 4 bytes by the
// library's size rule.
func testLibrary(t *testing.T) *codebookLibrary {
	t.Helper()
	packed := bitsOf(1, 4, 2, 14, 0, 1, 1, 3, 0, 1, 0, 1, 0, 1, 0, 1)
	packed = append(packed, make([]byte, 4-len(packed))...)
	raw := append(packed, 0, 0, 0, 0)              // offset of codebook 0
	raw = binary.LittleEndian.AppendUint32(raw, 4) // end of codebook 0 = the table's offset
	lib, err := parseLibrary(raw)
	if err != nil {
		t.Fatal(err)
	}
	return lib
}

// testCodebookFull is testLibrary's codebook in its standard form.
var testCodebookFull = []uint32{codebookSync, 24, 1, 16, 2, 24, 0, 1, 0, 1, 0, 5, 0, 5, 0, 4}

func TestRebuildCodebook(t *testing.T) {
	lib := testLibrary(t)
	var w bitWriter
	if err := lib.rebuild(0, &w); err != nil {
		t.Fatal(err)
	}
	if want := bitsOf(testCodebookFull...); !bytes.Equal(w.bytes(), want) {
		t.Fatalf("rebuilt % x, want % x", w.bytes(), want)
	}
	if err := lib.rebuild(1, &w); err == nil {
		t.Fatal("an id past the library was accepted")
	}
}

// TestRebuildCodebookSizeRule — a packed codebook with a spare byte beyond the rule is refused:
// it means the parse went wrong (the wrong library, or a misread field).
func TestRebuildCodebookSizeRule(t *testing.T) {
	packed := bitsOf(1, 4, 2, 14, 0, 1, 1, 3, 0, 1, 0, 1, 0, 1, 0, 1)
	packed = append(packed, make([]byte, 5-len(packed))...)
	raw := append(packed, 0, 0, 0, 0)
	raw = binary.LittleEndian.AppendUint32(raw, 5)
	lib, err := parseLibrary(raw)
	if err != nil {
		t.Fatal(err)
	}
	var w bitWriter
	if err := lib.rebuild(0, &w); err == nil {
		t.Fatal("a codebook of the wrong size was accepted")
	}
}

// TestRebuildOrderedWithLookup — an ordered codebook copies its run counts, and a lookup type 1
// table copies lookup1_values values of the declared width.
func TestRebuildOrderedWithLookup(t *testing.T) {
	// 2 dimensions, 9 entries: ordered from length 2 (stored 1), runs of 4 (ilog(9) = 4 bits)
	// then 5 (ilog(5) = 3 bits); lookup 1, min, delta, 2-bit values (stored 1), no sequence,
	// lookup1_values(9, 2) = 3 values.
	in := bitsOf(2, 4, 9, 14, 1, 1, 1, 5, 4, 4, 5, 3, 1, 1, 7, 32, 9, 32, 1, 4, 0, 1, 1, 2, 2, 2, 3, 2)
	want := bitsOf(codebookSync, 24, 2, 16, 9, 24, 1, 1, 1, 5, 4, 4, 5, 3, 1, 4, 7, 32, 9, 32, 1, 4, 0, 1, 1, 2, 2, 2, 3, 2)
	var w bitWriter
	if err := rebuildCodebook(newBitReader(in), &w); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(w.bytes(), want) {
		t.Fatalf("rebuilt % x, want % x", w.bytes(), want)
	}
}

// TestRebuildSparse — a sparse codebook keeps its presence flags and widens present lengths.
func TestRebuildSparse(t *testing.T) {
	in := bitsOf(1, 4, 3, 14, 0, 1, 2, 3, 1, 1, 1, 1, 3, 2, 0, 1, 1, 1, 1, 2, 0, 1)
	want := bitsOf(codebookSync, 24, 1, 16, 3, 24, 0, 1, 1, 1, 1, 1, 3, 5, 0, 1, 1, 1, 1, 5, 0, 4)
	var w bitWriter
	if err := rebuildCodebook(newBitReader(in), &w); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(w.bytes(), want) {
		t.Fatalf("rebuilt % x, want % x", w.bytes(), want)
	}
}

func TestLookup1Values(t *testing.T) {
	cases := [][3]uint32{{81, 4, 3}, {80, 4, 2}, {9, 2, 3}, {8, 3, 2}, {10, 1, 10}, {1, 8, 1}}
	for _, c := range cases {
		if got := lookup1Values(c[0], c[1]); got != c[2] {
			t.Fatalf("lookup1Values(%d, %d) = %d, want %d", c[0], c[1], got, c[2])
		}
	}
}

// TestEmbeddedLibrary — the embedded aoTuV library parses, and every codebook in it rebuilds
// using exactly its packed bytes.
func TestEmbeddedLibrary(t *testing.T) {
	lib, err := parseLibrary(packedCodebooks)
	if err != nil {
		t.Fatal(err)
	}
	n := len(lib.offsets) - 1
	if n < 500 {
		t.Fatalf("%d codebooks", n)
	}
	for id := range n {
		var w bitWriter
		if err := lib.rebuild(uint32(id), &w); err != nil {
			t.Fatal(err)
		}
	}
}

func TestParseLibraryRefusesBadTable(t *testing.T) {
	for _, raw := range [][]byte{{1, 2}, {0, 0, 0, 0, 9, 0, 0, 0}, {0, 0, 0, 0, 9, 0, 0, 0, 4, 0, 0, 0}} {
		if _, err := parseLibrary(raw); err == nil {
			t.Fatalf("library % x accepted", raw)
		}
	}
}
