package announcer

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// fakeToolEnv makes the test binary act as the decoder or the encoder extraction runs.
const fakeToolEnv = "ANNOUNCER_FAKE_TOOL"

// TestMain lets the test binary stand in for both tools when fakeToolEnv is set: vgmstream-cli
// when its first argument is "-o" ("-o out.wav in.wem": writes a WAV whose length is the media's
// first byte in tenths of a second), ffmpeg otherwise (copies its -i input to its last argument).
func TestMain(m *testing.M) {
	if os.Getenv(fakeToolEnv) != "" {
		if len(os.Args) > 1 && os.Args[1] == "-o" {
			os.Exit(fakeDecoder(os.Args[1:]))
		}
		os.Exit(fakeEncoder(os.Args[1:]))
	}
	os.Exit(m.Run())
}

func fakeDecoder(args []string) int {
	if len(args) != 3 || args[0] != "-o" {
		return 2
	}
	in, err := os.ReadFile(args[2])
	if err != nil || len(in) == 0 {
		return 1
	}
	if os.WriteFile(args[1], testWAV(int(in[0])*100), 0o644) != nil {
		return 1
	}
	return 0
}

func fakeEncoder(args []string) int {
	for i, a := range args {
		if a == "-i" && i+1 < len(args) {
			raw, err := os.ReadFile(args[i+1])
			if err != nil || os.WriteFile(args[len(args)-1], raw, 0o644) != nil {
				return 1
			}
			return 0
		}
	}
	return 2
}

// testWAV is a 48 kHz stereo 16-bit PCM WAV of the given length.
func testWAV(ms int) []byte {
	const rate, channels, bits = 48000, 2, 16
	bps := rate * channels * bits / 8
	data := bps * ms / 1000
	b := append([]byte("RIFF"), make([]byte, 4)...)
	b = append(b, "WAVEfmt "...)
	b = binary.LittleEndian.AppendUint32(b, 16)
	b = binary.LittleEndian.AppendUint16(b, 1)
	b = binary.LittleEndian.AppendUint16(b, channels)
	b = binary.LittleEndian.AppendUint32(b, rate)
	b = binary.LittleEndian.AppendUint32(b, uint32(bps))
	b = binary.LittleEndian.AppendUint16(b, channels*bits/8)
	b = binary.LittleEndian.AppendUint16(b, bits)
	b = append(b, "data"...)
	b = binary.LittleEndian.AppendUint32(b, uint32(data))
	return append(b, make([]byte, data)...)
}

func TestWAVDurationMs(t *testing.T) {
	if got, err := WAVDurationMs(testWAV(1713)); err != nil || got != 1713 {
		t.Fatalf("duration %d, %v", got, err)
	}
	if _, err := WAVDurationMs([]byte("OggS")); err == nil {
		t.Fatal("a non-WAV file has a duration")
	}
}

func TestExtractWritesFilesAndManifest(t *testing.T) {
	t.Setenv(fakeToolEnv, "1")
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	c := &Catalog{
		Lines: map[uint32]Line{
			StringID("doublekill"): {Vocalization: StringID("doublekill"), Takes: []Take{{Bank: "sb_main", Event: 0xE1, MediaIDs: []uint32{7, 8}}}},
		},
		embedded: map[uint32][]byte{7: {12}, 8: {5}},
	}
	out := t.TempDir()
	tools := Tools{Decoder: self, Encoder: self}
	opts := ExtractOptions{Names: []string{"doublekill", "nosuchline", "doublekill"}, Tools: tools, OutDir: out, Language: "en", GameLanguage: "English(US)"}
	res, err := Extract(context.Background(), c, opts)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(res.Missing, []string{"nosuchline"}) || res.Files != 2 {
		t.Fatalf("result: missing %v files %d", res.Missing, res.Files)
	}
	raw, err := os.ReadFile(filepath.Join(out, ManifestName))
	if err != nil {
		t.Fatal(err)
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	want := ManifestLine{Bank: "sb_main", Event: "000000e1", Takes: []ManifestTake{
		{File: "announcer_doublekill_01.ogg", Media: 7, DurationMs: 1200},
		{File: "announcer_doublekill_02.ogg", Media: 8, DurationMs: 500},
	}}
	if m.Version != ManifestVersion || m.Language != "en" || !reflect.DeepEqual(m.Lines["doublekill"], want) {
		t.Fatalf("manifest: %+v", m)
	}
	for _, tk := range want.Takes {
		if _, err := os.Stat(filepath.Join(out, tk.File)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestExtractRefusesMissingToolsAndBadNames(t *testing.T) {
	c := &Catalog{Lines: map[uint32]Line{}}
	if _, err := Extract(context.Background(), c, ExtractOptions{OutDir: t.TempDir()}); err == nil {
		t.Fatal("extraction ran without tools")
	}
	opts := ExtractOptions{Names: []string{"../escape"}, Tools: Tools{Decoder: "d", Encoder: "e"}, OutDir: t.TempDir()}
	if _, err := Extract(context.Background(), c, opts); err == nil {
		t.Fatal("a name with a path separator was accepted")
	}
}
