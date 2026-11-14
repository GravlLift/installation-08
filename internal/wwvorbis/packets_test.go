package wwvorbis

import (
	"bytes"
	"reflect"
	"testing"
)

// testFramer has a short mode 0 and a long mode 1, blocks of 256 and 2048 samples.
func testFramer(mod bool) audioFramer {
	return newAudioFramer(header{modPackets: mod, blocksize0Exp: 8, blocksize1Exp: 11}, []bool{false, true})
}

func TestSplitPackets(t *testing.T) {
	data := []byte{9, 9, 2, 0, 0xA, 0xB, 0, 0, 1, 0, 0xC}
	got, err := splitPackets(data, 2)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, [][]byte{{0xA, 0xB}, {}, {0xC}}) {
		t.Fatalf("packets %v", got)
	}
	if _, err := splitPackets([]byte{5, 0, 1}, 0); err == nil {
		t.Fatal("a truncated packet was accepted")
	}
	if _, err := splitPackets([]byte{1, 0, 1, 7}, 0); err == nil {
		t.Fatal("a truncated packet header was accepted")
	}
}

// TestRestoreModPacket — a long block gets the packet type bit, its mode, then the previous and
// next window flags before the rest of its first byte; a short block only the type bit.
func TestRestoreModPacket(t *testing.T) {
	a := testFramer(true)
	if got := a.restore([]byte{0x01, 0xFF}, false, true); !bytes.Equal(got, []byte{0x0A, 0xF8, 0x07}) {
		t.Fatalf("long block % x", got)
	}
	if got := a.restore([]byte{0xFE}, true, true); !bytes.Equal(got, []byte{0xFC, 0x01}) {
		t.Fatalf("short block % x", got)
	}
}

// TestModeOf — the mode is the first bits of a modified packet, the bits after the packet type
// of a standard one.
func TestModeOf(t *testing.T) {
	if m, err := testFramer(true).mode([]byte{0x01}); err != nil || m != 1 {
		t.Fatalf("modified: %d %v", m, err)
	}
	if m, err := testFramer(false).mode([]byte{0x02}); err != nil || m != 1 {
		t.Fatalf("standard: %d %v", m, err)
	}
	if _, err := testFramer(false).mode([]byte{0x01}); err == nil {
		t.Fatal("a standard packet of type 1 was accepted")
	}
}

// TestFrameGranules — samples are counted quarter block by quarter block, the first packet
// counting none; the last page ends at the header's sample count, flagged end of stream.
func TestFrameGranules(t *testing.T) {
	packets := [][]byte{{0x00}, {0x01, 0xFF}, {0x01}, {0x00}}
	w := newOggWriter(1)
	decoded, err := testFramer(true).frame(packets, 2000, w)
	if err != nil {
		t.Fatal(err)
	}
	if decoded != 0+576+1024+576 {
		t.Fatalf("decoded %d", decoded)
	}
	pages, got, err := readPages(w.bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 1 || pages[0].granule != 2000 {
		t.Fatalf("pages %+v", pages)
	}
	a := testFramer(true)
	want := [][]byte{a.restore(packets[0], false, true), a.restore(packets[1], false, true), a.restore(packets[2], true, false), a.restore(packets[3], true, false)}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("packets % x, want % x", got, want)
	}
}

// TestFrameStandardPackets — standard packets are copied as they are.
func TestFrameStandardPackets(t *testing.T) {
	packets := [][]byte{{0x00, 0x55}, {0x02, 0x66}}
	w := newOggWriter(1)
	if _, err := testFramer(false).frame(packets, 100, w); err != nil {
		t.Fatal(err)
	}
	_, got, err := readPages(w.bytes())
	if err != nil || !reflect.DeepEqual(got, packets) {
		t.Fatalf("packets % x, %v", got, err)
	}
}
