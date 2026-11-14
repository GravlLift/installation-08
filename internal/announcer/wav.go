package announcer

import (
	"encoding/binary"
	"errors"
)

// WAVDurationMs returns the duration of a PCM WAV file in milliseconds, from its `fmt ` chunk
// (rate, channels, sample size) and the size of its `data` chunk, rounded to the nearest ms.
func WAVDurationMs(b []byte) (int, error) {
	if len(b) < 12 || string(b[:4]) != "RIFF" || string(b[8:12]) != "WAVE" {
		return 0, errors.New("announcer: not a WAV file")
	}
	le := binary.LittleEndian
	bytesPerSecond := 0
	for off := 12; off+8 <= len(b); {
		id := string(b[off : off+4])
		size := int(le.Uint32(b[off+4:]))
		body := off + 8
		switch id {
		case "fmt ":
			if body+16 > len(b) {
				return 0, errors.New("announcer: short WAV fmt chunk")
			}
			bytesPerSecond = int(le.Uint32(b[body+8:]))
		case "data":
			if bytesPerSecond <= 0 {
				return 0, errors.New("announcer: WAV data before a valid fmt chunk")
			}
			if body+size > len(b) {
				size = len(b) - body
			}
			return (size*1000 + bytesPerSecond/2) / bytesPerSecond, nil
		}
		off = body + size + size%2
	}
	return 0, errors.New("announcer: WAV without a data chunk")
}
