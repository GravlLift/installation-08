package wwvorbis

import (
	"encoding/binary"
	"fmt"
)

// splitPackets cuts the audio packets out of the data chunk from offset start: each is a 2-byte
// little-endian size, then that many bytes.
func splitPackets(data []byte, start uint32) ([][]byte, error) {
	var out [][]byte
	for off := int(start); off < len(data); {
		if off+2 > len(data) {
			return nil, fmt.Errorf("wwvorbis: packet header truncated at %d", off)
		}
		size := int(binary.LittleEndian.Uint16(data[off:]))
		off += 2
		if off+size > len(data) {
			return nil, fmt.Errorf("wwvorbis: packet of %d bytes truncated at %d", size, off)
		}
		out = append(out, data[off:off+size])
		off += size
	}
	return out, nil
}

// audioFramer turns Wwise audio packets into Vorbis audio packets and frames them in Ogg pages.
type audioFramer struct {
	modes      []bool // block flag of each mode, from the setup header
	modeBits   uint
	modPackets bool
	blocksize  [2]uint64 // short and long block sizes
}

func newAudioFramer(h header, modes []bool) audioFramer {
	return audioFramer{
		modes:      modes,
		modeBits:   ilog(uint32(len(modes) - 1)),
		modPackets: h.modPackets,
		blocksize:  [2]uint64{1 << h.blocksize0Exp, 1 << h.blocksize1Exp},
	}
}

// mode returns the mode number an audio packet opens with: right at its start in a modified
// packet, after the 1-bit packet type (0, audio) in a standard one.
func (a audioFramer) mode(p []byte) (uint32, error) {
	r := newBitReader(p)
	if !a.modPackets && r.read(1) != 0 {
		return 0, fmt.Errorf("wwvorbis: audio packet of type 1")
	}
	m := r.read(a.modeBits)
	if r.err != nil || int(m) >= len(a.modes) {
		return 0, fmt.Errorf("wwvorbis: audio packet mode %d of %d", m, len(a.modes))
	}
	return m, nil
}

// restore rebuilds the first bits a modified packet lacks: the packet type, then after the mode
// number, for a long block, the window flags of the previous and next blocks.
func (a audioFramer) restore(p []byte, prevLong, nextLong bool) []byte {
	r := newBitReader(p[:1])
	w := &bitWriter{}
	w.write(0, 1)
	m := r.read(a.modeBits)
	w.write(m, a.modeBits)
	if a.modes[m] {
		w.write(boolBit(prevLong), 1)
		w.write(boolBit(nextLong), 1)
	}
	w.write(r.read(8-a.modeBits), 8-a.modeBits)
	w.writeBytes(p[1:])
	return w.bytes()
}

// frame writes the audio packets to w and returns the samples they decode to. Each packet after
// the first decodes a quarter of the previous block plus a quarter of its own; a page's granule
// is the sample count after its last packet, capped at sampleCount, so the last page ends the
// stream at the header's own length and a decoder drops the padding of the final block.
func (a audioFramer) frame(packets [][]byte, sampleCount uint32, w *oggWriter) (uint64, error) {
	var decoded, prevBlock uint64
	prevLong := false
	for i, p := range packets {
		out := p
		if len(p) > 0 {
			m, err := a.mode(p)
			if err != nil {
				return 0, fmt.Errorf("packet %d: %w", i, err)
			}
			long := a.modes[m]
			if a.modPackets {
				out = a.restore(p, prevLong, a.nextLong(packets, i))
			}
			block := a.blocksize[boolBit(long)]
			if prevBlock != 0 {
				decoded += prevBlock/4 + block/4
			}
			prevBlock, prevLong = block, long
		}
		w.packet(out, int64(min(decoded, uint64(sampleCount))))
		if last := i == len(packets)-1; last || w.pendingBytes() >= oggPageTarget {
			w.flush(last)
		}
	}
	return decoded, nil
}

// nextLong reports whether the packet after packets[i] is a long block (false when there is
// none or it is empty).
func (a audioFramer) nextLong(packets [][]byte, i int) bool {
	if i+1 >= len(packets) || len(packets[i+1]) == 0 {
		return false
	}
	m, err := a.mode(packets[i+1])
	return err == nil && a.modes[m]
}

func boolBit(b bool) uint32 {
	if b {
		return 1
	}
	return 0
}
