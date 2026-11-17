// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package wwvorbis

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

// wemSpec describes a synthetic Wwise Vorbis media in the layout parseHeader reads.
type wemSpec struct {
	samples   uint32
	modSignal uint32
	setup     []byte
	packets   [][]byte
}

// testWem builds the media: a 0x42 `fmt ` chunk (stereo, 48 kHz, blocks 2^8 and 2^11), then a
// data chunk holding a 4-byte seek table, the setup packet and the audio packets, each behind
// its 2-byte size.
func testWem(s wemSpec) []byte {
	le := binary.LittleEndian
	var data []byte
	data = append(data, 0xEE, 0xEE, 0xEE, 0xEE)
	setupAt := uint32(len(data))
	data = le.AppendUint16(data, uint16(len(s.setup)))
	data = append(data, s.setup...)
	audioAt := uint32(len(data))
	for _, p := range s.packets {
		data = le.AppendUint16(data, uint16(len(p)))
		data = append(data, p...)
	}
	f := make([]byte, fmtSizeVorbis)
	le.PutUint16(f, formatTagVorbis)
	le.PutUint16(f[2:], 2)
	le.PutUint32(f[4:], 48000)
	le.PutUint32(f[8:], 16000)
	le.PutUint16(f[16:], fmtSizeVorbis-0x12)
	le.PutUint32(f[20:], 3)
	v := f[vorbFields:]
	le.PutUint32(v, s.samples)
	le.PutUint32(v[4:], s.modSignal)
	le.PutUint32(v[0x10:], setupAt)
	le.PutUint32(v[0x14:], audioAt)
	v[0x28], v[0x29] = 8, 11
	b := append([]byte("RIFF"), 0, 0, 0, 0)
	b = append(b, "WAVEfmt "...)
	b = le.AppendUint32(b, uint32(len(f)))
	b = append(b, f...)
	b = append(b, "data"...)
	b = le.AppendUint32(b, uint32(len(data)))
	b = append(b, data...)
	le.PutUint32(b[4:], uint32(len(b)-8))
	return b
}

func testSpec() wemSpec {
	return wemSpec{samples: 2000, modSignal: 0xE0, setup: strippedSetup(), packets: [][]byte{{0x00}, {0x01, 0xFF}, {0x01}, {0x00}}}
}

func TestParseHeader(t *testing.T) {
	h, err := parseHeader(testWem(testSpec()))
	if err != nil {
		t.Fatal(err)
	}
	if h.channels != 2 || h.sampleRate != 48000 || h.sampleCount != 2000 || !h.modPackets || h.setupOffset != 4 ||
		h.blocksize0Exp != 8 || h.blocksize1Exp != 11 || h.avgBytesPerSec != 16000 {
		t.Fatalf("header %+v", h)
	}
	s := testSpec()
	s.modSignal = 0x4A
	if h, err := parseHeader(testWem(s)); err != nil || h.modPackets {
		t.Fatalf("mod signal 0x4A: %+v %v", h, err)
	}
}

// TestParseHeaderRefusesOtherLayouts — a vorb chunk, another fmt size, a big-endian RIFX or
// another codec are refused rather than misread.
func TestParseHeaderRefusesOtherLayouts(t *testing.T) {
	base := testWem(testSpec())
	vorb := append(append([]byte(nil), base...), "vorb\x00\x00\x00\x00"...)
	rifx := append([]byte("RIFX"), base[4:]...)
	opus := append([]byte(nil), base...)
	binary.LittleEndian.PutUint16(opus[20:], 0x3040)
	short := append([]byte(nil), base[:20]...)
	short = binary.LittleEndian.AppendUint32(short[:16], 0x18)
	short = append(short, base[20:20+0x18]...)
	short = append(short, base[20+fmtSizeVorbis:]...)
	for name, b := range map[string][]byte{"vorb": vorb, "rifx": rifx, "opus": opus, "fmt 0x18": short} {
		if _, err := parseHeader(b); err == nil {
			t.Fatalf("%s accepted", name)
		}
	}
}

// TestRepack — the file is the identification header alone on page 0, the comment and setup
// headers on page 1, then the audio; the last page ends at the header's sample count.
func TestRepack(t *testing.T) {
	s, err := repack(testWem(testSpec()), testLibrary(t))
	if err != nil {
		t.Fatal(err)
	}
	if s.Channels != 2 || s.SampleRate != 48000 || s.Samples != 2000 || s.DurationMs() != 42 {
		t.Fatalf("stream %+v", s)
	}
	pages, packets, err := readPages(s.Ogg)
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 3 || pages[0].granule != 0 || pages[1].granule != 0 || pages[2].granule != 2000 || len(packets) != 7 {
		t.Fatalf("%d pages %+v, %d packets", len(pages), pages, len(packets))
	}
	id := packets[0]
	if len(id) != 30 || id[0] != packetIdentification || string(id[1:7]) != vorbisMagic || id[11] != 2 ||
		binary.LittleEndian.Uint32(id[12:]) != 48000 || id[28] != 0xB8 || id[29] != 1 {
		t.Fatalf("identification % x", id)
	}
	if c := packets[1]; c[0] != packetComment || !strings.Contains(string(c), "ww2ogg") || c[len(c)-1] != 1 {
		t.Fatalf("comment %q", c)
	}
	if !bytes.Equal(packets[2], standardSetup()) {
		t.Fatal("setup header differs")
	}
}

// TestRepackRefusesShortAudio — packets that decode fewer samples than the header says are an
// error, not a silently shorter file.
func TestRepackRefusesShortAudio(t *testing.T) {
	s := testSpec()
	s.samples = 5000
	if _, err := repack(testWem(s), testLibrary(t)); err == nil {
		t.Fatal("audio shorter than the header was accepted")
	}
}

// TestRepackRefusesMisplacedSetup — the setup packet must end where the audio starts.
func TestRepackRefusesMisplacedSetup(t *testing.T) {
	b := testWem(testSpec())
	at := 12 + 8 + vorbFields + 0x14
	binary.LittleEndian.PutUint32(b[at:], binary.LittleEndian.Uint32(b[at:])+2)
	if _, err := repack(b, testLibrary(t)); err == nil {
		t.Fatal("a setup packet that does not end at the audio was accepted")
	}
}
