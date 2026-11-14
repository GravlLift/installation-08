package wwvorbis

import (
	_ "embed"
	"encoding/binary"
	"errors"
	"fmt"
)

// packedCodebooks is ww2ogg's packed codebook library for the aoTuV 6.03 encoder Wwise uses
// (`packed_codebooks_aoTuV_603.bin`, unmodified; provenance in third_party/ww2ogg/NOTICE.md).
// A stripped setup header names each codebook by its index in this library.
//
//go:embed packed_codebooks_aoTuV_603.bin
var packedCodebooks []byte

// codebookSync is the 24-bit pattern "BCV" that opens a Vorbis codebook.
const codebookSync = 0x564342

// codebookLibrary is a packed codebook file: the codebooks back to back, then a table of their
// 32-bit offsets, the last 4 bytes of the file being the table's own offset.
type codebookLibrary struct {
	data    []byte
	offsets []uint32
}

// parseLibrary reads a packed codebook file.
func parseLibrary(raw []byte) (*codebookLibrary, error) {
	if len(raw) < 4 {
		return nil, errors.New("wwvorbis: codebook library too short")
	}
	table := int(binary.LittleEndian.Uint32(raw[len(raw)-4:]))
	if table > len(raw)-4 || (len(raw)-table)%4 != 0 {
		return nil, errors.New("wwvorbis: codebook library offset table out of range")
	}
	lib := &codebookLibrary{data: raw[:table]}
	for at := table; at < len(raw); at += 4 {
		off := binary.LittleEndian.Uint32(raw[at:])
		if int(off) > table {
			return nil, errors.New("wwvorbis: codebook offset out of range")
		}
		lib.offsets = append(lib.offsets, off)
	}
	return lib, nil
}

// codebook returns the packed bytes of codebook id. The table's last entry closes the last
// codebook, so it is not a codebook itself.
func (l *codebookLibrary) codebook(id uint32) ([]byte, error) {
	if int(id)+1 >= len(l.offsets) {
		return nil, fmt.Errorf("wwvorbis: codebook id %d is not in the library (%d codebooks)", id, len(l.offsets)-1)
	}
	start, end := l.offsets[id], l.offsets[id+1]
	if start > end {
		return nil, fmt.Errorf("wwvorbis: codebook %d has a negative size", id)
	}
	return l.data[start:end], nil
}

// rebuild writes codebook id as a standard Vorbis codebook. The packed form must be consumed
// exactly: its byte count is the bits read rounded down, plus one (ww2ogg's rule, which leaves
// one spare byte when the bits end on a byte boundary).
func (l *codebookLibrary) rebuild(id uint32, w *bitWriter) error {
	packed, err := l.codebook(id)
	if err != nil {
		return err
	}
	r := newBitReader(packed)
	if err := rebuildCodebook(r, w); err != nil {
		return fmt.Errorf("codebook %d: %w", id, err)
	}
	if used := r.bitsRead()/8 + 1; used != uint64(len(packed)) {
		return fmt.Errorf("wwvorbis: codebook %d used %d of its %d bytes", id, used, len(packed))
	}
	return nil
}

// rebuildCodebook expands one packed codebook: 4-bit dimensions and 14-bit entry count become the
// sync pattern, 16 and 24 bits; codeword lengths stored on a declared width become 5-bit; the
// 1-bit lookup type becomes 4 bits. Everything else is copied.
func rebuildCodebook(r *bitReader, w *bitWriter) error {
	dimensions := r.read(4)
	entries := r.read(14)
	w.write(codebookSync, 24)
	w.write(dimensions, 16)
	w.write(entries, 24)
	if copyBits(r, w, 1) == 1 { // ordered
		copyBits(r, w, 5) // initial length
		for current := uint32(0); current < entries; {
			current += copyBits(r, w, ilog(entries-current))
			if r.err != nil {
				return r.err
			}
		}
	} else if err := rebuildLengths(r, w, entries); err != nil {
		return err
	}
	lookup := r.read(1)
	w.write(lookup, 4)
	if lookup == 1 {
		copyBits(r, w, 32) // minimum value
		copyBits(r, w, 32) // delta value
		valueBits := copyBits(r, w, 4) + 1
		copyBits(r, w, 1) // sequence flag
		quantvals := lookup1Values(entries, dimensions)
		for range quantvals {
			copyBits(r, w, uint(valueBits))
		}
	}
	return r.err
}

// rebuildLengths expands the codeword lengths of an unordered codebook.
func rebuildLengths(r *bitReader, w *bitWriter, entries uint32) error {
	width := r.read(3)
	sparse := r.read(1)
	if width == 0 || width > 5 {
		return fmt.Errorf("wwvorbis: codeword length width %d", width)
	}
	w.write(sparse, 1)
	for range entries {
		if sparse == 1 && copyBits(r, w, 1) == 0 {
			continue
		}
		w.write(r.read(uint(width)), 5)
	}
	return r.err
}

// lookup1Values is the Vorbis lookup1_values: the largest integer whose dimensions-th power does
// not exceed entries.
func lookup1Values(entries, dimensions uint32) uint32 {
	if dimensions == 0 {
		return 0
	}
	pow := func(v uint32) uint64 {
		acc := uint64(1)
		for range dimensions {
			acc *= uint64(v)
			if acc > uint64(entries) {
				return acc
			}
		}
		return acc
	}
	v := uint32(0)
	for pow(v+1) <= uint64(entries) {
		v++
	}
	return v
}
