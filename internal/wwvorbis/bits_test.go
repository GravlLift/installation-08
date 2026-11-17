// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package wwvorbis

import (
	"bytes"
	"testing"
)

// TestBitRoundTrip — values of odd widths written then read back come out equal, packed least
// significant bit first.
func TestBitRoundTrip(t *testing.T) {
	type field struct {
		v uint32
		n uint
	}
	fields := []field{{1, 1}, {5, 3}, {0x2A5, 10}, {0xFFFFFFFF, 32}, {0, 7}, {0x1590, 14}, {3, 2}}
	var w bitWriter
	for _, f := range fields {
		w.write(f.v, f.n)
	}
	r := newBitReader(w.bytes())
	for _, f := range fields {
		if got := r.read(f.n); got != f.v {
			t.Fatalf("read %d bits: got %#x want %#x", f.n, got, f.v)
		}
	}
	if r.err != nil || r.bitsRead() != 69 {
		t.Fatalf("err %v, bits %d", r.err, r.bitsRead())
	}
}

// TestBitPacking — the first bit written is the lowest bit of the first byte.
func TestBitPacking(t *testing.T) {
	var w bitWriter
	w.write(1, 1)
	w.write(0, 1)
	w.write(0x3F, 6)
	w.write(1, 1)
	if !bytes.Equal(w.bytes(), []byte{0xFD, 0x01}) {
		t.Fatalf("bytes % x", w.bytes())
	}
}

// TestBitWriteBytes — whole bytes land shifted by the current bit position.
func TestBitWriteBytes(t *testing.T) {
	var w bitWriter
	w.writeBytes([]byte{0xAB})
	w.write(1, 1)
	w.writeBytes([]byte{0x80, 0x01})
	if !bytes.Equal(w.bytes(), []byte{0xAB, 0x01, 0x03, 0x00}) {
		t.Fatalf("bytes % x", w.bytes())
	}
}

// TestBitReaderPastEnd — a read past the end is an error, and stays one.
func TestBitReaderPastEnd(t *testing.T) {
	r := newBitReader([]byte{0xFF})
	r.read(8)
	if r.err != nil {
		t.Fatal(r.err)
	}
	if r.read(1) != 0 || r.err != errOutOfBits {
		t.Fatalf("err %v", r.err)
	}
}

func TestIlog(t *testing.T) {
	for v, want := range map[uint32]uint{0: 0, 1: 1, 2: 2, 3: 2, 4: 3, 7: 3, 255: 8, 256: 9} {
		if got := ilog(v); got != want {
			t.Fatalf("ilog(%d) = %d, want %d", v, got, want)
		}
	}
}
