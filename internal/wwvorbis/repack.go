// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package wwvorbis

import (
	"encoding/binary"
	"errors"
	"fmt"
	"sync"
)

// Stream is a repacked media: a standard Ogg Vorbis file and what it holds.
type Stream struct {
	Ogg        []byte
	Channels   int
	SampleRate int
	// Samples is the stream's length in samples per channel: the media header's own count, which
	// the last Ogg page's granule position carries.
	Samples uint64
}

// DurationMs is the stream's length in milliseconds, rounded to the nearest.
func (s Stream) DurationMs() int {
	return int((s.Samples*1000 + uint64(s.SampleRate)/2) / uint64(s.SampleRate))
}

// vendor is the comment header's vendor string.
const vendor = "infinite-theater-3d wwvorbis (Wwise Vorbis repack, ported from ww2ogg by hcs)"

// oggSerial is the stream serial number of every file written (one logical stream per file).
const oggSerial = 1

var library = sync.OnceValues(func() (*codebookLibrary, error) { return parseLibrary(packedCodebooks) })

// Repack rebuilds a Wwise Vorbis media (a `.wem`) as an Ogg Vorbis file, without decoding: the
// identification and comment headers are written from the RIFF header, the setup header is
// rebuilt from its stripped form, and the audio packets are restored and framed in pages.
func Repack(wem []byte) (Stream, error) {
	lib, err := library()
	if err != nil {
		return Stream{}, err
	}
	return repack(wem, lib)
}

func repack(wem []byte, lib *codebookLibrary) (Stream, error) {
	h, err := parseHeader(wem)
	if err != nil {
		return Stream{}, err
	}
	setupIn, err := setupPacket(h)
	if err != nil {
		return Stream{}, err
	}
	setup, modes, err := rewriteSetup(setupIn, h.channels, lib)
	if err != nil {
		return Stream{}, err
	}
	packets, err := splitPackets(h.data, h.audioOffset)
	if err != nil {
		return Stream{}, err
	}
	if len(packets) == 0 {
		return Stream{}, errors.New("wwvorbis: media without audio packets")
	}
	w := newOggWriter(oggSerial)
	w.packet(identificationHeader(h), 0)
	w.flush(false)
	w.packet(commentHeader(), 0)
	w.packet(setup, 0)
	w.flush(false)
	decoded, err := newAudioFramer(h, modes).frame(packets, h.sampleCount, w)
	if err != nil {
		return Stream{}, err
	}
	if decoded < uint64(h.sampleCount) {
		return Stream{}, fmt.Errorf("wwvorbis: the packets decode %d samples, the header says %d", decoded, h.sampleCount)
	}
	return Stream{Ogg: w.bytes(), Channels: h.channels, SampleRate: int(h.sampleRate), Samples: uint64(h.sampleCount)}, nil
}

// setupPacket returns the stripped setup packet, which must end where the first audio packet
// starts.
func setupPacket(h header) ([]byte, error) {
	at := int(h.setupOffset)
	if at+2 > len(h.data) {
		return nil, errors.New("wwvorbis: setup packet header outside the data chunk")
	}
	size := int(binary.LittleEndian.Uint16(h.data[at:]))
	if at+2+size != int(h.audioOffset) {
		return nil, fmt.Errorf("wwvorbis: setup packet ends at %d, audio starts at %d", at+2+size, h.audioOffset)
	}
	return h.data[at+2 : at+2+size], nil
}

// identificationHeader is the Vorbis identification header of the media: version 0, its channels
// and rate, the nominal bitrate from its byte rate, its two block sizes.
func identificationHeader(h header) []byte {
	b := append([]byte{packetIdentification}, vorbisMagic...)
	b = binary.LittleEndian.AppendUint32(b, 0)
	b = append(b, byte(h.channels))
	b = binary.LittleEndian.AppendUint32(b, h.sampleRate)
	b = binary.LittleEndian.AppendUint32(b, 0)                  // maximum bitrate
	b = binary.LittleEndian.AppendUint32(b, h.avgBytesPerSec*8) // nominal bitrate
	b = binary.LittleEndian.AppendUint32(b, 0)                  // minimum bitrate
	b = append(b, h.blocksize1Exp<<4|h.blocksize0Exp)
	return append(b, 1) // framing
}

// commentHeader is a Vorbis comment header with the vendor string and no user comment.
func commentHeader() []byte {
	b := append([]byte{packetComment}, vorbisMagic...)
	b = binary.LittleEndian.AppendUint32(b, uint32(len(vendor)))
	b = append(b, vendor...)
	b = binary.LittleEndian.AppendUint32(b, 0)
	return append(b, 1) // framing
}
