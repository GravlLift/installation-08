// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package meshopt

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

// TestVertexRoundTrip — the vertex codec gives back the bytes it was given, at format version 0
// (the EXT_meshopt_compression format: the header byte is 0xa0).
func TestVertexRoundTrip(t *testing.T) {
	const count, stride = 1000, 12
	data := make([]byte, count*stride)
	for i := range count {
		for c := range 3 {
			binary.LittleEndian.PutUint32(data[i*stride+c*4:], math.Float32bits(float32(i)*0.25+float32(c)))
		}
	}
	enc, err := EncodeVertexBuffer(data, count, stride)
	if err != nil {
		t.Fatal(err)
	}
	if enc[0] != 0xa0 {
		t.Errorf("header %#x, want 0xa0 (vertex format version 0)", enc[0])
	}
	if len(enc) >= len(data) {
		t.Errorf("encoded %d bytes from %d: no gain on smooth data", len(enc), len(data))
	}
	dec, err := DecodeVertexBuffer(enc, count, stride)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(dec, data) {
		t.Fatal("vertex round trip changed the data")
	}
	if _, err := EncodeVertexBuffer(data[:10], 1, 10); err == nil {
		t.Error("stride 10 accepted")
	}
}

// TestIndexRoundTrip — the index buffer and sequence codecs give back their indices, as 32-bit
// and 16-bit outputs.
func TestIndexRoundTrip(t *testing.T) {
	idx := []uint32{0, 1, 2, 2, 1, 3, 3, 1, 4, 100, 101, 102}
	for name, enc := range map[string]func([]uint32, int) ([]byte, error){"buffer": EncodeIndexBuffer, "sequence": EncodeIndexSequence} {
		b, err := enc(idx, 103)
		if err != nil {
			t.Fatal(name, err)
		}
		for _, size := range []int{2, 4} {
			var out []byte
			if name == "buffer" {
				out, err = DecodeIndexBuffer(b, len(idx), size)
			} else {
				out, err = DecodeIndexSequence(b, len(idx), size)
			}
			if err != nil {
				t.Fatal(name, size, err)
			}
			for i, want := range idx {
				var got uint32
				if size == 2 {
					got = uint32(binary.LittleEndian.Uint16(out[i*2:]))
				} else {
					got = binary.LittleEndian.Uint32(out[i*4:])
				}
				if got != want {
					t.Fatalf("%s/%d: index %d = %d, want %d", name, size, i, got, want)
				}
			}
		}
	}
	if _, err := EncodeIndexBuffer([]uint32{0, 1}, 2); err == nil {
		t.Error("two indices accepted as a triangle list")
	}
}

// TestFilterExp — the exponential filter at 24 bits with shared component exponents is exact
// on values of a common power-of-two grid within the mantissa's range.
func TestFilterExp(t *testing.T) {
	const count = 64
	data := make([]float32, count*3)
	for i := range data {
		data[i] = float32(i-90) / 1024 // multiples of 2^-10, |v| < 0.1
	}
	enc, err := EncodeFilterExp(data, count, 12, 24, ExpSharedComponent)
	if err != nil {
		t.Fatal(err)
	}
	DecodeFilterExp(enc, count, 12)
	for i, want := range data {
		if got := math.Float32frombits(binary.LittleEndian.Uint32(enc[i*4:])); got != want {
			t.Fatalf("value %d = %v, want %v", i, got, want)
		}
	}
}
