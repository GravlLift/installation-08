// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package wwvorbis

import (
	"errors"
	"fmt"
)

// Wwise strips the Vorbis setup header: no packet type and "vorbis" magic, codebooks by 10-bit
// library id, and the fields whose value is fixed (time domain count, floor, residue and mapping
// types narrowed or dropped, window and transform types). rewriteSetup reads the stripped form
// and writes the standard one, field by field (Vorbis I specification, section 4.2.4).

// vorbisMagic follows the packet type byte of each Vorbis header.
const vorbisMagic = "vorbis"

// Vorbis header packet types.
const (
	packetIdentification = 1
	packetComment        = 3
	packetSetup          = 5
)

// rewriteSetup turns a stripped setup packet into a standard setup header. It returns the header
// and the block flag of each mode (true for a long block), which the audio packets need.
func rewriteSetup(in []byte, channels int, lib *codebookLibrary) ([]byte, []bool, error) {
	r := newBitReader(in)
	w := &bitWriter{}
	w.write(packetSetup, 8)
	w.writeBytes([]byte(vorbisMagic))
	codebooks, err := rewriteCodebooks(r, w, lib)
	if err != nil {
		return nil, nil, err
	}
	w.write(0, 6)  // time domain transform count - 1
	w.write(0, 16) // its one placeholder value
	floors, err := rewriteFloors(r, w, codebooks)
	if err != nil {
		return nil, nil, err
	}
	residues, err := rewriteResidues(r, w, codebooks)
	if err != nil {
		return nil, nil, err
	}
	mappings, err := rewriteMappings(r, w, channels, floors, residues)
	if err != nil {
		return nil, nil, err
	}
	modes, err := rewriteModes(r, w, mappings)
	if err != nil {
		return nil, nil, err
	}
	w.write(1, 1) // framing
	if used := (r.bitsRead() + 7) / 8; used != uint64(len(in)) {
		return nil, nil, fmt.Errorf("wwvorbis: setup packet is %d bytes, the parse used %d", len(in), used)
	}
	return w.bytes(), modes, nil
}

// rewriteCodebooks rebuilds every codebook from its library id and returns their count.
func rewriteCodebooks(r *bitReader, w *bitWriter, lib *codebookLibrary) (uint32, error) {
	count := copyBits(r, w, 8) + 1
	for range count {
		id := r.read(10)
		if r.err != nil {
			return 0, r.err
		}
		if err := lib.rebuild(id, w); err != nil {
			return 0, err
		}
	}
	return count, r.err
}

// rewriteFloors copies the floors (always floor type 1, whose 16-bit type Wwise drops) and
// returns their count.
func rewriteFloors(r *bitReader, w *bitWriter, codebooks uint32) (uint32, error) {
	count := copyBits(r, w, 6) + 1
	for range count {
		w.write(1, 16)
		if err := rewriteFloor1(r, w, codebooks); err != nil {
			return 0, err
		}
	}
	return count, r.err
}

// rewriteFloor1 copies one floor 1 configuration, checking its book numbers.
func rewriteFloor1(r *bitReader, w *bitWriter, codebooks uint32) error {
	partitions := copyBits(r, w, 5)
	classOf := make([]uint32, partitions)
	maxClass := uint32(0)
	for i := range classOf {
		classOf[i] = copyBits(r, w, 4)
		maxClass = max(maxClass, classOf[i])
	}
	dimensions := make([]uint32, maxClass+1)
	for c := range dimensions {
		dimensions[c] = copyBits(r, w, 3) + 1
		subclasses := copyBits(r, w, 2)
		if subclasses != 0 && copyBits(r, w, 8) >= codebooks {
			return errors.New("wwvorbis: floor 1 master book out of range")
		}
		for range uint32(1) << subclasses {
			if book := int(copyBits(r, w, 8)) - 1; book >= int(codebooks) {
				return errors.New("wwvorbis: floor 1 subclass book out of range")
			}
		}
	}
	copyBits(r, w, 2) // multiplier - 1
	rangeBits := copyBits(r, w, 4)
	for _, c := range classOf {
		for range dimensions[c] {
			copyBits(r, w, uint(rangeBits))
		}
	}
	return r.err
}

// rewriteResidues copies the residues (their 16-bit type stored on 2 bits) and returns their
// count.
func rewriteResidues(r *bitReader, w *bitWriter, codebooks uint32) (uint32, error) {
	count := copyBits(r, w, 6) + 1
	for range count {
		kind := r.read(2)
		if kind > 2 {
			return 0, fmt.Errorf("wwvorbis: residue type %d", kind)
		}
		w.write(kind, 16)
		copyBits(r, w, 24) // begin
		copyBits(r, w, 24) // end
		copyBits(r, w, 24) // partition size - 1
		classifications := copyBits(r, w, 6) + 1
		if copyBits(r, w, 8) >= codebooks {
			return 0, errors.New("wwvorbis: residue class book out of range")
		}
		cascade := make([]uint32, classifications)
		for i := range cascade {
			cascade[i] = copyBits(r, w, 3)
			if copyBits(r, w, 1) == 1 {
				cascade[i] |= copyBits(r, w, 5) << 3
			}
		}
		for _, bits := range cascade {
			for k := range 8 {
				if bits&(1<<k) != 0 && copyBits(r, w, 8) >= codebooks {
					return 0, errors.New("wwvorbis: residue book out of range")
				}
			}
		}
	}
	return count, r.err
}

// rewriteMappings copies the mappings (always type 0, whose 16-bit type Wwise drops) and returns
// their count.
func rewriteMappings(r *bitReader, w *bitWriter, channels int, floors, residues uint32) (uint32, error) {
	count := copyBits(r, w, 6) + 1
	for range count {
		w.write(0, 16)
		if err := rewriteMapping(r, w, channels, floors, residues); err != nil {
			return 0, err
		}
	}
	return count, r.err
}

// rewriteMapping copies one mapping type 0 configuration.
func rewriteMapping(r *bitReader, w *bitWriter, channels int, floors, residues uint32) error {
	submaps := uint32(1)
	if copyBits(r, w, 1) == 1 {
		submaps = copyBits(r, w, 4) + 1
	}
	if copyBits(r, w, 1) == 1 { // square polar coupling
		steps := copyBits(r, w, 8) + 1
		width := ilog(uint32(channels - 1))
		for range steps {
			magnitude, angle := copyBits(r, w, width), copyBits(r, w, width)
			if magnitude == angle || int(magnitude) >= channels || int(angle) >= channels {
				return errors.New("wwvorbis: invalid channel coupling")
			}
		}
	}
	if copyBits(r, w, 2) != 0 {
		return errors.New("wwvorbis: mapping reserved field is not zero")
	}
	if submaps > 1 {
		for range channels {
			if copyBits(r, w, 4) >= submaps {
				return errors.New("wwvorbis: mapping multiplex out of range")
			}
		}
	}
	for range submaps {
		copyBits(r, w, 8) // unused time configuration
		if copyBits(r, w, 8) >= floors {
			return errors.New("wwvorbis: mapping floor out of range")
		}
		if copyBits(r, w, 8) >= residues {
			return errors.New("wwvorbis: mapping residue out of range")
		}
	}
	return r.err
}

// rewriteModes copies the modes (Wwise drops their 16-bit window and transform types, always 0)
// and returns each mode's block flag.
func rewriteModes(r *bitReader, w *bitWriter, mappings uint32) ([]bool, error) {
	count := copyBits(r, w, 6) + 1
	flags := make([]bool, count)
	for i := range flags {
		flags[i] = copyBits(r, w, 1) == 1
		w.write(0, 16) // window type
		w.write(0, 16) // transform type
		if copyBits(r, w, 8) >= mappings {
			return nil, errors.New("wwvorbis: mode mapping out of range")
		}
	}
	return flags, r.err
}
