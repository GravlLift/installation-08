// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package wwise

import (
	"encoding/binary"
	"errors"
	"strings"
)

// ID returns the Wwise id of a name: the 32-bit FNV-1 hash (multiply, then xor) of the name in
// lowercase. Banks, events and other named objects are addressed by it.
func ID(name string) uint32 {
	h := uint32(2166136261)
	for _, c := range []byte(strings.ToLower(name)) {
		h *= 16777619
		h ^= uint32(c)
	}
	return h
}

// Codec names of the RIFF format tags Wwise writes in a `.wem`.
const (
	CodecVorbis = "wwise-vorbis" // 0xFFFF
	CodecOpus   = "wwise-opus"   // 0x3040, 0x3041
	CodecPCM    = "pcm"          // 0x0001
	CodecADPCM  = "wwise-adpcm"  // 0x0002
)

// MediaFormat is what a `.wem` header says of its audio.
type MediaFormat struct {
	FormatTag  uint16
	Codec      string
	Channels   int
	SampleRate int
}

// ParseMediaFormat reads the RIFF/WAVE `fmt ` chunk of a `.wem`.
func ParseMediaFormat(b []byte) (MediaFormat, error) {
	if len(b) < 12 || string(b[:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return MediaFormat{}, errors.New("wwise: not a RIFF/WAVE media")
	}
	for off := 12; off+8 <= len(b); {
		magic := string(b[off : off+4])
		size := int(binary.LittleEndian.Uint32(b[off+4:]))
		body := off + 8
		if magic == "fmt " {
			if size < 8 || body+8 > len(b) {
				return MediaFormat{}, errors.New("wwise: short fmt chunk")
			}
			tag := binary.LittleEndian.Uint16(b[body:])
			return MediaFormat{
				FormatTag:  tag,
				Codec:      codecName(tag),
				Channels:   int(binary.LittleEndian.Uint16(b[body+2:])),
				SampleRate: int(binary.LittleEndian.Uint32(b[body+4:])),
			}, nil
		}
		off = body + size + size%2
	}
	return MediaFormat{}, errors.New("wwise: no fmt chunk")
}

func codecName(tag uint16) string {
	switch tag {
	case 0xFFFF:
		return CodecVorbis
	case 0x3040, 0x3041:
		return CodecOpus
	case 0x0001:
		return CodecPCM
	case 0x0002:
		return CodecADPCM
	}
	return "unknown"
}
