// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package wwvorbis

import "encoding/binary"

// Ogg framing (RFC 3533): a page is a 27-byte header, a lacing table of at most 255 segment
// sizes, and the segments. A packet is a run of 255-byte segments closed by one shorter segment
// (possibly empty); a page's granule position is that of the last packet that ends on it, or -1
// when none does.
const (
	oggMaxSegments = 255
	oggSegmentSize = 255
	// oggPageTarget is the body size after which an audio page is closed, as encoders do (about
	// 4 KB): fewer, larger pages than one per packet, small enough to seek well.
	oggPageTarget = 4096
)

// Header type flags of an Ogg page.
const (
	oggContinued = 1 // the page starts inside a packet begun on the previous page
	oggFirst     = 2 // beginning of stream
	oggLast      = 4 // end of stream
)

// oggWriter frames the packets of one logical stream into pages.
type oggWriter struct {
	out       []byte
	serial    uint32
	seq       uint32
	lacing    []byte
	body      []byte
	granule   int64 // of the last packet ended on the pending page, -1 when none
	started   bool  // a page has been written
	continued bool  // the pending page starts inside a packet
}

func newOggWriter(serial uint32) *oggWriter { return &oggWriter{serial: serial, granule: -1} }

// packet appends a packet whose last sample is at granule. A packet that does not fit in the
// pending page's lacing table goes on across pages.
func (w *oggWriter) packet(p []byte, granule int64) {
	begun := false
	for {
		if len(w.lacing) == oggMaxSegments {
			w.flush(false)
			w.continued = begun
		}
		n := min(oggSegmentSize, len(p))
		w.lacing = append(w.lacing, byte(n))
		w.body = append(w.body, p[:n]...)
		p = p[n:]
		begun = true
		if n < oggSegmentSize {
			break
		}
	}
	w.granule = granule
}

// pendingBytes is the body size of the page being filled.
func (w *oggWriter) pendingBytes() int { return len(w.body) }

// flush writes the pending page, flagged end of stream when last. It does nothing when no
// segment is pending.
func (w *oggWriter) flush(last bool) {
	if len(w.lacing) == 0 {
		return
	}
	var flags byte
	if w.continued {
		flags |= oggContinued
	}
	if !w.started {
		flags |= oggFirst
	}
	if last {
		flags |= oggLast
	}
	start := len(w.out)
	w.out = append(w.out, 'O', 'g', 'g', 'S', 0, flags)
	w.out = binary.LittleEndian.AppendUint64(w.out, uint64(w.granule))
	w.out = binary.LittleEndian.AppendUint32(w.out, w.serial)
	w.out = binary.LittleEndian.AppendUint32(w.out, w.seq)
	w.out = binary.LittleEndian.AppendUint32(w.out, 0) // CRC, filled below
	w.out = append(w.out, byte(len(w.lacing)))
	w.out = append(w.out, w.lacing...)
	w.out = append(w.out, w.body...)
	binary.LittleEndian.PutUint32(w.out[start+22:], oggCRC(w.out[start:]))
	w.seq++
	w.started = true
	w.continued = false
	w.granule = -1
	w.lacing = w.lacing[:0]
	w.body = w.body[:0]
}

// bytes returns the pages written so far.
func (w *oggWriter) bytes() []byte { return w.out }

// oggCRCTable is the Ogg CRC-32: polynomial 0x04C11DB7, most significant bit first, initial
// value 0, no final xor.
var oggCRCTable = func() (t [256]uint32) {
	for i := range t {
		r := uint32(i) << 24
		for range 8 {
			if r&0x80000000 != 0 {
				r = r<<1 ^ 0x04C11DB7
			} else {
				r <<= 1
			}
		}
		t[i] = r
	}
	return t
}()

// oggCRC is the checksum of a page whose CRC field holds zero.
func oggCRC(b []byte) uint32 {
	var c uint32
	for _, x := range b {
		c = c<<8 ^ oggCRCTable[byte(c>>24)^x]
	}
	return c
}
