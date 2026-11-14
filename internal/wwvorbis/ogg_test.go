package wwvorbis

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"testing"
)

// oggPage is one page as readPages parses it.
type oggPage struct {
	flags   byte
	granule int64
	seq     uint32
}

// readPages is a strict Ogg reader: every page must have the capture pattern, version 0, one
// serial, consecutive sequence numbers and a correct CRC; the first page alone is flagged
// beginning of stream and the last alone end of stream; a page flagged continued must follow a
// page that left a packet open. It returns the pages and the reassembled packets.
func readPages(b []byte) ([]oggPage, [][]byte, error) {
	var pages []oggPage
	var packets [][]byte
	var open []byte
	inPacket := false
	for off := 0; off < len(b); {
		if len(b)-off < 27 || string(b[off:off+4]) != "OggS" || b[off+4] != 0 {
			return nil, nil, fmt.Errorf("page %d: bad header at %d", len(pages), off)
		}
		nseg := int(b[off+26])
		body := off + 27 + nseg
		size := 0
		for _, l := range b[off+27 : body] {
			size += int(l)
		}
		end := body + size
		if end > len(b) {
			return nil, nil, fmt.Errorf("page %d: truncated", len(pages))
		}
		page := append([]byte(nil), b[off:end]...)
		want := binary.LittleEndian.Uint32(page[22:])
		binary.LittleEndian.PutUint32(page[22:], 0)
		if oggCRC(page) != want {
			return nil, nil, fmt.Errorf("page %d: CRC mismatch", len(pages))
		}
		p := oggPage{flags: b[off+5], granule: int64(binary.LittleEndian.Uint64(b[off+6:])), seq: binary.LittleEndian.Uint32(b[off+18:])}
		if p.seq != uint32(len(pages)) || (p.flags&oggFirst != 0) != (len(pages) == 0) || (p.flags&oggContinued != 0) != inPacket {
			return nil, nil, fmt.Errorf("page %d: sequence %d flags %#x", len(pages), p.seq, p.flags)
		}
		at := body
		for _, l := range b[off+27 : body] {
			open = append(open, b[at:at+int(l)]...)
			at += int(l)
			inPacket = l == oggSegmentSize
			if !inPacket {
				packets = append(packets, open)
				open = nil
			}
		}
		pages = append(pages, p)
		off = end
	}
	for i, p := range pages {
		if (p.flags&oggLast != 0) != (i == len(pages)-1) {
			return nil, nil, fmt.Errorf("page %d: end-of-stream flag %#x", i, p.flags)
		}
	}
	if inPacket {
		return nil, nil, fmt.Errorf("stream ends inside a packet")
	}
	return pages, packets, nil
}

// TestOggCRCTable — the table is the one of the Ogg reference implementation.
func TestOggCRCTable(t *testing.T) {
	if oggCRCTable[1] != 0x04C11DB7 || oggCRCTable[128] != 0x690CE0EE || oggCRCTable[255] != 0xB1F740B4 {
		t.Fatalf("table %#x %#x %#x", oggCRCTable[1], oggCRCTable[128], oggCRCTable[255])
	}
}

// TestOggFraming — packets come back whole, including a packet of an exact multiple of 255
// bytes (closed by an empty segment) and one longer than a page's lacing table; granules are
// those of the last packet ended on each page, -1 on a page where none ends.
func TestOggFraming(t *testing.T) {
	w := newOggWriter(7)
	in := [][]byte{bytes.Repeat([]byte{1}, 30), bytes.Repeat([]byte{2}, 510), bytes.Repeat([]byte{3}, 255*300+3), {4}}
	w.packet(in[0], 0)
	w.flush(false)
	w.packet(in[1], 100)
	w.packet(in[2], 200)
	w.packet(in[3], 300)
	w.flush(true)
	pages, packets, err := readPages(w.bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(packets) != len(in) {
		t.Fatalf("%d packets", len(packets))
	}
	for i := range in {
		if !bytes.Equal(packets[i], in[i]) {
			t.Fatalf("packet %d differs (%d bytes, want %d)", i, len(packets[i]), len(in[i]))
		}
	}
	// Page 1 holds packet 1 (3 segments) and the first 252 segments of packet 2; page 2 the
	// rest of packet 2 and packet 3.
	want := []int64{0, 100, 300}
	if len(pages) != len(want) {
		t.Fatalf("%d pages", len(pages))
	}
	for i, p := range pages {
		if p.granule != want[i] {
			t.Fatalf("page %d granule %d, want %d", i, p.granule, want[i])
		}
	}
}

// TestOggFlushEmpty — flushing with nothing pending writes nothing.
func TestOggFlushEmpty(t *testing.T) {
	w := newOggWriter(1)
	w.flush(true)
	if len(w.bytes()) != 0 {
		t.Fatal("an empty page was written")
	}
}

// TestOggNoPacketEnds — a page on which no packet ends carries granule -1.
func TestOggNoPacketEnds(t *testing.T) {
	w := newOggWriter(1)
	w.packet(bytes.Repeat([]byte{9}, 255*600), 50)
	w.flush(true)
	pages, packets, err := readPages(w.bytes())
	if err != nil {
		t.Fatal(err)
	}
	if len(packets) != 1 || len(pages) != 3 || pages[0].granule != -1 || pages[1].granule != -1 || pages[2].granule != 50 {
		t.Fatalf("pages %+v", pages)
	}
}
