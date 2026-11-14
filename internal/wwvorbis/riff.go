package wwvorbis

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// The one Wwise Vorbis layout this package reads, the one Halo Infinite's voice media use (all
// 168 announcer lines): a little-endian RIFF whose `fmt ` chunk is 0x42 bytes and carries the
// Vorbis fields itself (no `vorb` chunk). In that layout the audio packets have 2-byte headers
// (size only, no granule), the setup header is stripped (codebooks by id in the external
// library), and the mod signal tells whether the audio packets are modified (their first byte
// lacks the packet type and window flags).
const (
	formatTagVorbis = 0xFFFF
	fmtSizeVorbis   = 0x42
	// vorbFields is where the Vorbis fields start inside the 0x42 `fmt ` chunk.
	vorbFields = 0x18
)

// modSignalsStandard are the mod signal values of streams whose packets are standard Vorbis
// packets (ww2ogg's observations); any other value means modified packets.
var modSignalsStandard = map[uint32]bool{0x4A: true, 0x4B: true, 0x69: true, 0x70: true}

// header is what a Wwise Vorbis media's RIFF header says.
type header struct {
	channels       int
	sampleRate     uint32
	avgBytesPerSec uint32
	sampleCount    uint32
	modPackets     bool
	setupOffset    uint32 // of the setup packet's header, from the start of data
	audioOffset    uint32 // of the first audio packet's header, from the start of data
	blocksize0Exp  uint8
	blocksize1Exp  uint8
	data           []byte // the `data` chunk's body
}

// parseHeader reads the RIFF chunks of a `.wem` and the Vorbis fields of its `fmt ` chunk.
func parseHeader(b []byte) (header, error) {
	if len(b) < 12 || string(b[:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return header{}, errors.New("wwvorbis: not a little-endian RIFF/WAVE media")
	}
	var fmtBody, data []byte
	sawVorb := false
	for off := 12; off+8 <= len(b); {
		id := string(b[off : off+4])
		size := int(binary.LittleEndian.Uint32(b[off+4:]))
		body := off + 8
		if size < 0 || body+size > len(b) {
			return header{}, fmt.Errorf("wwvorbis: chunk %q truncated", id)
		}
		switch id {
		case "fmt ":
			fmtBody = b[body : body+size]
		case "vorb":
			sawVorb = true
		case "data":
			data = b[body : body+size]
		}
		off = body + size + size%2
	}
	if fmtBody == nil || data == nil {
		return header{}, errors.New("wwvorbis: media without fmt or data chunk")
	}
	if sawVorb || len(fmtBody) != fmtSizeVorbis {
		return header{}, fmt.Errorf("wwvorbis: unsupported Wwise Vorbis layout (fmt chunk of %#x bytes, vorb chunk %v): only the 0x42 fmt chunk with built-in Vorbis fields is read", len(fmtBody), sawVorb)
	}
	return readFmt(fmtBody, data)
}

// readFmt decodes the 0x42 `fmt ` chunk: the WAVEFORMATEX part, then the Vorbis fields.
func readFmt(f, data []byte) (header, error) {
	le := binary.LittleEndian
	if le.Uint16(f) != formatTagVorbis {
		return header{}, fmt.Errorf("wwvorbis: format tag %#04x is not Wwise Vorbis", le.Uint16(f))
	}
	if le.Uint16(f[12:]) != 0 || le.Uint16(f[14:]) != 0 || int(le.Uint16(f[16:])) != fmtSizeVorbis-0x12 {
		return header{}, errors.New("wwvorbis: unexpected block align, sample size or extension size")
	}
	v := f[vorbFields:]
	h := header{
		channels:       int(le.Uint16(f[2:])),
		sampleRate:     le.Uint32(f[4:]),
		avgBytesPerSec: le.Uint32(f[8:]),
		sampleCount:    le.Uint32(v),
		modPackets:     !modSignalsStandard[le.Uint32(v[4:])],
		setupOffset:    le.Uint32(v[0x10:]),
		audioOffset:    le.Uint32(v[0x14:]),
		blocksize0Exp:  v[0x28],
		blocksize1Exp:  v[0x29],
		data:           data,
	}
	if h.channels < 1 || h.channels > 255 || h.sampleRate == 0 {
		return header{}, fmt.Errorf("wwvorbis: %d channels at %d Hz", h.channels, h.sampleRate)
	}
	if h.blocksize0Exp < 6 || h.blocksize0Exp > h.blocksize1Exp || h.blocksize1Exp > 13 {
		return header{}, fmt.Errorf("wwvorbis: block sizes 2^%d, 2^%d", h.blocksize0Exp, h.blocksize1Exp)
	}
	if int(h.audioOffset) > len(data) || h.setupOffset >= h.audioOffset {
		return header{}, errors.New("wwvorbis: setup or audio offset outside the data chunk")
	}
	return h, nil
}
