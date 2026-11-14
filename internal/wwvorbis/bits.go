package wwvorbis

import "errors"

// errOutOfBits is the error of a read past the end of a bit reader's bytes.
var errOutOfBits = errors.New("wwvorbis: read past the end of the packet")

// bitReader reads a Vorbis bitstream: values packed least significant bit first, starting at the
// lowest bit of each byte. A read past the end sets a sticky error and returns zeros, so a parser
// checks the error once after a run of reads.
type bitReader struct {
	b   []byte
	pos uint64 // bits read
	err error
}

func newBitReader(b []byte) *bitReader { return &bitReader{b: b} }

// read returns the next n bits (n <= 32) as an unsigned value.
func (r *bitReader) read(n uint) uint32 {
	var v uint32
	for i := uint(0); i < n; i++ {
		if r.pos>>3 >= uint64(len(r.b)) {
			r.err = errOutOfBits
			return 0
		}
		if r.b[r.pos>>3]&(1<<(r.pos&7)) != 0 {
			v |= 1 << i
		}
		r.pos++
	}
	return v
}

// bitsRead is the number of bits consumed so far.
func (r *bitReader) bitsRead() uint64 { return r.pos }

// bitWriter builds a Vorbis bitstream with the same packing as bitReader.
type bitWriter struct {
	b    []byte
	used uint // bits used in the last byte of b, 0 when it is full or b is empty
}

// write appends the low n bits (n <= 32) of v.
func (w *bitWriter) write(v uint32, n uint) {
	for i := uint(0); i < n; i++ {
		if w.used == 0 {
			w.b = append(w.b, 0)
		}
		if v&(1<<i) != 0 {
			w.b[len(w.b)-1] |= 1 << w.used
		}
		w.used = (w.used + 1) & 7
	}
}

// writeBytes appends whole bytes at the current bit position.
func (w *bitWriter) writeBytes(p []byte) {
	if w.used == 0 {
		w.b = append(w.b, p...)
		return
	}
	for _, c := range p {
		w.write(uint32(c), 8)
	}
}

// bytes returns the stream, its last byte padded with zero bits.
func (w *bitWriter) bytes() []byte { return w.b }

// copyBits reads n bits from r, writes them to w and returns them.
func copyBits(r *bitReader, w *bitWriter, n uint) uint32 {
	v := r.read(n)
	w.write(v, n)
	return v
}

// ilog is the Vorbis ilog: the number of bits needed to hold v (0 for 0).
func ilog(v uint32) uint {
	n := uint(0)
	for ; v != 0; v >>= 1 {
		n++
	}
	return n
}
