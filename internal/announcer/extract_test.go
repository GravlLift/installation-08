// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package announcer

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

// testSetup is a synthetic stripped Wwise setup packet: one codebook (library id 0), one floor,
// one residue, one stereo mapping, a short and a long mode.
var testSetup = []byte{
	0x00, 0x00, 0x00, 0x01, 0x40, 0x40, 0x94, 0x40, 0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x0f, 0x00,
	0x00, 0x00, 0x40, 0x00, 0x00, 0x02, 0x08, 0x00, 0x00, 0x40, 0x00, 0x20, 0x00,
}

// testWem is a synthetic Wwise Vorbis media in the game's layout (0x42 `fmt ` chunk, 2-byte
// packet headers, modified packets) whose header says it is samples long. Its four audio packets
// (short, long, long, short at 256/2048-sample blocks) decode 2176 samples, so samples must not
// exceed that.
func testWem(samples uint32) []byte {
	le := binary.LittleEndian
	data := []byte{0, 0, 0, 0}
	data = le.AppendUint16(data, uint16(len(testSetup)))
	data = append(data, testSetup...)
	audio := uint32(len(data))
	for _, p := range [][]byte{{0x00}, {0x01}, {0x01}, {0x00}} {
		data = le.AppendUint16(data, uint16(len(p)))
		data = append(data, p...)
	}
	f := make([]byte, 0x42)
	le.PutUint16(f, 0xFFFF)
	le.PutUint16(f[2:], 2)
	le.PutUint32(f[4:], 48000)
	le.PutUint16(f[16:], 0x30)
	le.PutUint32(f[0x18:], samples)
	le.PutUint32(f[0x1C:], 0xE0)
	le.PutUint32(f[0x28:], 4)
	le.PutUint32(f[0x2C:], audio)
	f[0x40], f[0x41] = 8, 11
	b := append([]byte("RIFF\x00\x00\x00\x00WAVEfmt "), 0x42, 0, 0, 0)
	b = append(b, f...)
	b = append(append(b, "data"...), le.AppendUint32(nil, uint32(len(data)))...)
	return append(b, data...)
}

func TestExtractWritesFilesAndManifest(t *testing.T) {
	c := &Catalog{
		Lines: map[uint32]Line{
			StringID("doublekill"): {Vocalization: StringID("doublekill"), Takes: []Take{{Bank: "sb_main", Event: 0xE1, MediaIDs: []uint32{7, 8}}}},
		},
		embedded: map[uint32][]byte{7: testWem(2000), 8: testWem(1000)},
	}
	out := t.TempDir()
	opts := ExtractOptions{Names: []string{"doublekill", "nosuchline", "doublekill"}, OutDir: out, Language: "en", GameLanguage: "English(US)"}
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
		{File: "announcer_doublekill_01.ogg", Media: 7, DurationMs: 42},
		{File: "announcer_doublekill_02.ogg", Media: 8, DurationMs: 21},
	}}
	if m.Version != ManifestVersion || m.Language != "en" || !reflect.DeepEqual(m.Lines["doublekill"], want) {
		t.Fatalf("manifest: %+v", m)
	}
	var total int64
	for _, tk := range want.Takes {
		b, err := os.ReadFile(filepath.Join(out, tk.File))
		if err != nil || !bytes.HasPrefix(b, []byte("OggS")) {
			t.Fatalf("%s: %v", tk.File, err)
		}
		total += int64(len(b))
	}
	if res.Bytes != total {
		t.Fatalf("bytes %d, want %d", res.Bytes, total)
	}
	if built, stale := ManifestStatus(out); !built || stale {
		t.Fatalf("fresh manifest: built %v stale %v", built, stale)
	}
}

// TestExtractRemovesStaleTakes — a rebuild deletes the take files of earlier extractions its
// manifest no longer lists (older formats included), and leaves every other file alone.
func TestExtractRemovesStaleTakes(t *testing.T) {
	out := t.TempDir()
	stale := []string{"announcer_doublekill_01.wav", "announcer_doublekill_03.ogg", "announcer_gone_01.ogg"}
	kept := []string{"explosion.ogg", "announcer_notes.txt", "announcer_x.ogg", "end_defeat_voice_en_01.ogg"}
	for _, f := range append(append([]string{}, stale...), kept...) {
		if err := os.WriteFile(filepath.Join(out, f), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(filepath.Join(out, "announcer_dir_01.ogg"), 0o755); err != nil {
		t.Fatal(err)
	}
	c := &Catalog{
		Lines:    map[uint32]Line{StringID("doublekill"): {Takes: []Take{{Bank: "b", Event: 1, MediaIDs: []uint32{7}}}}},
		embedded: map[uint32][]byte{7: testWem(2000)},
	}
	res, err := Extract(context.Background(), c, ExtractOptions{Names: []string{"doublekill"}, OutDir: out})
	if err != nil {
		t.Fatal(err)
	}
	if res.Removed != len(stale) {
		t.Fatalf("removed %d, want %d", res.Removed, len(stale))
	}
	for _, f := range stale {
		if _, err := os.Stat(filepath.Join(out, f)); !os.IsNotExist(err) {
			t.Fatalf("%s survived: %v", f, err)
		}
	}
	for _, f := range append(kept, "announcer_doublekill_01.ogg", "announcer_dir_01.ogg", ManifestName) {
		if _, err := os.Stat(filepath.Join(out, f)); err != nil {
			t.Fatalf("%s: %v", f, err)
		}
	}
}

// TestExtractRefusesBadMedia — a media that is not Wwise Vorbis fails the extraction.
func TestExtractRefusesBadMedia(t *testing.T) {
	c := &Catalog{
		Lines:    map[uint32]Line{StringID("doublekill"): {Takes: []Take{{Bank: "b", Event: 1, MediaIDs: []uint32{7}}}}},
		embedded: map[uint32][]byte{7: []byte("RIFF\x04\x00\x00\x00WAVE")},
	}
	if _, err := Extract(context.Background(), c, ExtractOptions{Names: []string{"doublekill"}, OutDir: t.TempDir()}); err == nil {
		t.Fatal("a media without Vorbis fields was extracted")
	}
}

// TestManifestStatus — no manifest is not built; an older version is built but stale; an
// unreadable one is not built.
func TestManifestStatus(t *testing.T) {
	dir := t.TempDir()
	if built, stale := ManifestStatus(dir); built || stale {
		t.Fatalf("absent: built %v stale %v", built, stale)
	}
	write := func(body string) {
		if err := os.WriteFile(filepath.Join(dir, ManifestName), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write(`{"version":2,"lines":{}}`)
	if built, stale := ManifestStatus(dir); !built || !stale {
		t.Fatalf("version 2: built %v stale %v", built, stale)
	}
	write(`not json`)
	if built, _ := ManifestStatus(dir); built {
		t.Fatal("an unreadable manifest counts as built")
	}
}

func TestExtractRefusesBadNames(t *testing.T) {
	c := &Catalog{Lines: map[uint32]Line{}}
	opts := ExtractOptions{Names: []string{"../escape"}, OutDir: t.TempDir()}
	if _, err := Extract(context.Background(), c, opts); err == nil {
		t.Fatal("a name with a path separator was accepted")
	}
}
