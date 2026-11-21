package himodule

import (
	"bytes"
	"encoding/binary"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Synthetic archive for the `.module_hd1` tests: two entries, one in the archive's data section
// (a single raw blob) and one in the companion (one raw block), with the header fields the reader
// uses. Raw blocks keep the test free of Kraken data.
const (
	testDelta     = 0x2000 // hd1Delta of the synthetic archive
	testHd1Skip   = 0x20   // offset of the hd1 entry inside the companion
	testDataStart = 0x1000 // start of the archive's data section
)

var (
	testMainPayload = []byte("archive payload!")                 // 16 bytes
	testHd1Payload  = []byte("companion payload, 32 bytes long") // 32 bytes
)

// writeTestModule writes the synthetic archive under dir and, when hd1 is not nil, its companion;
// it returns the archive's path.
func writeTestModule(t *testing.T, dir string, hd1 []byte) string {
	t.Helper()
	le := binary.LittleEndian
	buf := make([]byte, testDataStart+len(testMainPayload))
	copy(buf, "mohd")
	le.PutUint32(buf[4:], 53)
	le.PutUint32(buf[0x10:], 2) // fileCount
	le.PutUint32(buf[0x2C:], 1) // blockCount
	le.PutUint64(buf[offHdrHd1Delta:], testDelta)
	le.PutUint64(buf[offHdrDataSize:], uint64(len(testMainPayload)))

	e0 := headerSize // in the archive: no block, one raw blob at data offset 0
	copy(buf[e0+offGroup:], "mtib")
	le.PutUint64(buf[e0+offDataOffset:], 0)
	le.PutUint32(buf[e0+offCompSize:], uint32(len(testMainPayload)))
	le.PutUint32(buf[e0+offUncompSize:], uint32(len(testMainPayload)))
	le.PutUint32(buf[e0+offGlobalID:], 0x11111111)

	e1 := headerSize + entryStride // in the companion: one raw block
	copy(buf[e1+offGroup:], "mtib")
	le.PutUint16(buf[e1+offBlockCount:], 1)
	le.PutUint32(buf[e1+offFirstBlock:], 0)
	le.PutUint64(buf[e1+offDataOffset:], 1<<48|(testDelta+testHd1Skip))
	le.PutUint32(buf[e1+offCompSize:], uint32(len(testHd1Payload)))
	le.PutUint32(buf[e1+offUncompSize:], uint32(len(testHd1Payload)))
	le.PutUint32(buf[e1+offGlobalID:], 0x22222222)

	b := testDataStart - blockEntrySize // the block table ends where the data section starts
	le.PutUint32(buf[b+4:], uint32(len(testHd1Payload)))
	le.PutUint32(buf[b+12:], uint32(len(testHd1Payload)))
	copy(buf[testDataStart:], testMainPayload)

	path := filepath.Join(dir, "synthetic.module")
	if err := os.WriteFile(path, buf, 0o600); err != nil {
		t.Fatal(err)
	}
	if hd1 != nil {
		if err := os.WriteFile(path+"_hd1", hd1, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return path
}

// testCompanion is a companion that holds the hd1 entry at testHd1Skip and ends with it.
func testCompanion() []byte {
	return append(bytes.Repeat([]byte{0xEE}, testHd1Skip), testHd1Payload...)
}

func openTestModule(t *testing.T, hd1 []byte) (*Module, []File) {
	t.Helper()
	m, err := Open(writeTestModule(t, t.TempDir(), hd1))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = m.Close() })
	files := m.Files("")
	if len(files) != 2 || files[0].UseHd1() || !files[1].UseHd1() {
		t.Fatalf("entries %+v: want one archive entry, then one hd1 entry", files)
	}
	return m, files
}

func TestHd1EntryReadsAtDataOffsetMinusDelta(t *testing.T) {
	m, files := openTestModule(t, testCompanion())
	got, err := m.Extract(files[1])
	if err != nil || !bytes.Equal(got, testHd1Payload) {
		t.Fatalf("hd1 entry: %q, %v; want %q", got, err, testHd1Payload)
	}
	got, err = m.Extract(files[0])
	if err != nil || !bytes.Equal(got, testMainPayload) {
		t.Fatalf("archive entry: %q, %v; want %q", got, err, testMainPayload)
	}
}

func TestHd1CompanionRefusedOrAbsent(t *testing.T) {
	for name, hd1 := range map[string][]byte{
		"absent":    nil,
		"truncated": testCompanion()[:testHd1Skip+len(testHd1Payload)-1],
		"empty":     {},
	} {
		t.Run(name, func(t *testing.T) {
			m, files := openTestModule(t, hd1)
			if _, err := m.Extract(files[1]); err == nil || !strings.Contains(err.Error(), "hd1") {
				t.Fatalf("hd1 entry with a companion %s: error %v, want an hd1 error", name, err)
			}
			if got, err := m.Extract(files[0]); err != nil || !bytes.Equal(got, testMainPayload) {
				t.Fatalf("archive entry: %q, %v", got, err)
			}
		})
	}
}

func TestHd1Base(t *testing.T) {
	entry := func(off int64, size int) File { return File{DataOffset: off, CompSize: size, Flags: 1} }
	cases := []struct {
		name   string
		delta  uint64
		hd1Len int64
		ents   []File
		ok     bool
	}{
		{"first entry at offset 0, last ends at the end", 0x1000, 0x30, []File{entry(0x1000, 0x10), entry(0x1010, 0x20)}, true},
		{"entry inside the file", 0x1000, 0x100, []File{entry(0x1040, 0x10)}, true},
		{"entry one byte past the end", 0x1000, 0x30, []File{entry(0x1000, 0x10), entry(0x1010, 0x21)}, false},
		{"entry before the companion", 0x1000, 0x100, []File{entry(0xFFF, 0x10)}, false},
		{"no delta", 0, 0x100, []File{entry(0x10, 0x10)}, false},
		{"delta past 48 bits", 1 << 48, 0x100, []File{entry(0x10, 0x10)}, false},
		{"empty companion", 0x1000, 0, []File{entry(0x1000, 0)}, false},
	}
	for _, c := range cases {
		base, err := hd1Base(c.delta, c.hd1Len, c.ents)
		if c.ok && (err != nil || base != -int(c.delta)) {
			t.Errorf("%s: base %d, %v; want %d", c.name, base, err, -int(c.delta))
		}
		if !c.ok && err == nil {
			t.Errorf("%s: base %d accepted, want a refusal", c.name, base)
		}
	}
}
