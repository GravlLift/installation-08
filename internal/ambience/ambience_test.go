package ambience

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
)

// The tag file layout internal/announcer.ParseTag reads: a fixed header with the table counts at
// 0x18 and the header length at 0x38, then the dependency (0x18 B), block (0x10 B), struct
// (0x20 B), data reference (0x14 B, none here) and tag reference (0x10 B) tables; the tag data
// (section 1) follows the header.
const (
	testTagMagic    = 0x68736375
	testHeaderFixed = 0x50
	testDepSize     = 0x18
	testBlockSize   = 0x10
	testStructSize  = 0x20
	testRefSize     = 0x10
)

type testDep struct {
	group string
	id    uint32
}

type testTag struct {
	deps    []testDep
	data    []byte
	blocks  [][2]int // size, offset in the tag data
	structs [][4]int // type, target, block, offset
	refs    [][3]int // block, offset, dep
}

func (tt *testTag) block(b []byte) int {
	tt.blocks = append(tt.blocks, [2]int{len(b), len(tt.data)})
	tt.data = append(tt.data, b...)
	return len(tt.blocks) - 1
}

func (tt *testTag) link(typ, target, block, offset int) {
	tt.structs = append(tt.structs, [4]int{typ, target, block, offset})
}

func (tt *testTag) ref(block, offset, dep int) { tt.refs = append(tt.refs, [3]int{block, offset, dep}) }

func (tt *testTag) parse(t *testing.T) *announcer.Tag {
	t.Helper()
	le := binary.LittleEndian
	header := testHeaderFixed + len(tt.deps)*testDepSize + len(tt.blocks)*testBlockSize +
		len(tt.structs)*testStructSize + len(tt.refs)*testRefSize
	b := make([]byte, header, header+len(tt.data))
	le.PutUint32(b, testTagMagic)
	for i, n := range []int{len(tt.deps), len(tt.blocks), len(tt.structs), 0, len(tt.refs)} {
		le.PutUint32(b[0x18+4*i:], uint32(n))
	}
	le.PutUint32(b[0x38:], uint32(header))
	o := testHeaderFixed
	for _, d := range tt.deps {
		le.PutUint32(b[o:], uint32(d.group[0])<<24|uint32(d.group[1])<<16|uint32(d.group[2])<<8|uint32(d.group[3]))
		le.PutUint32(b[o+0x10:], d.id)
		o += testDepSize
	}
	for _, bl := range tt.blocks {
		le.PutUint32(b[o:], uint32(bl[0]))
		le.PutUint16(b[o+6:], 1)
		le.PutUint64(b[o+8:], uint64(bl[1]))
		o += testBlockSize
	}
	for _, s := range tt.structs {
		le.PutUint16(b[o+16:], uint16(s[0]))
		le.PutUint32(b[o+20:], uint32(int32(s[1])))
		le.PutUint32(b[o+24:], uint32(int32(s[2])))
		le.PutUint32(b[o+28:], uint32(s[3]))
		o += testStructSize
	}
	for _, r := range tt.refs {
		le.PutUint32(b[o:], uint32(int32(r[0])))
		le.PutUint32(b[o+4:], uint32(r[1]))
		le.PutUint32(b[o+12:], uint32(int32(r[2])))
		o += testRefSize
	}
	tag, err := announcer.ParseTag(append(b, tt.data...))
	if err != nil {
		t.Fatal(err)
	}
	return tag
}

// testLevel builds a level whose palette has four zones: zone 0 names loop A, zone 1 loop B,
// zone 2 nothing but a sound environment, zone 3 loop B again.
func testLevel(t *testing.T) *testTag {
	t.Helper()
	tt := &testTag{deps: []testDep{{"lsnd", 0xA}, {"lsnd", 0xB}, {"snde", 0xE}}}
	root := tt.block(make([]byte, levelOffPalette+24))
	tt.link(0, root, -1, 0)
	palette := tt.block(make([]byte, 4*paletteStride))
	tt.link(structTagBlock, palette, root, levelOffPalette)
	tt.ref(palette, paletteOffLoop, 0)
	tt.ref(palette, paletteStride+paletteOffLoop, 1)
	tt.ref(palette, 2*paletteStride+0x64, 2)
	tt.ref(palette, 3*paletteStride+paletteOffLoop, 1)
	tt.ref(root, paletteOffLoop, 0) // a reference outside the palette is not a zone
	return tt
}

func TestZoneLoopsReadsThePalette(t *testing.T) {
	got, err := zoneLoops(testLevel(t).parse(t))
	if err != nil {
		t.Fatal(err)
	}
	want := []zoneLoop{{0, 0xA}, {1, 0xB}, {3, 0xB}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("zones %+v, want %+v", got, want)
	}
	loop, distinct, ok := mainLoop(got)
	if !ok || loop != 0xB || distinct != 2 {
		t.Fatalf("main loop %x (%d distinct, %v), want b of 2", loop, distinct, ok)
	}
}

func TestZoneLoopsWithoutPaletteOrWithABadOne(t *testing.T) {
	tt := &testTag{}
	tt.link(0, tt.block(make([]byte, 8)), -1, 0)
	if got, err := zoneLoops(tt.parse(t)); err != nil || got != nil {
		t.Fatalf("no palette: %+v %v", got, err)
	}
	tt = &testTag{}
	root := tt.block(make([]byte, levelOffPalette+24))
	tt.link(0, root, -1, 0)
	tt.link(structTagBlock, tt.block(make([]byte, paletteStride+4)), root, levelOffPalette)
	if _, err := zoneLoops(tt.parse(t)); err == nil {
		t.Fatal("a palette that is not a whole number of zones was read")
	}
}

func TestMainLoopBreaksTiesOnTheEarliestZone(t *testing.T) {
	loop, distinct, ok := mainLoop([]zoneLoop{{0, 0xC}, {1, 0xD}, {2, 0xD}, {3, 0xC}})
	if !ok || loop != 0xC || distinct != 2 {
		t.Fatalf("tie: %x %d %v, want c", loop, distinct, ok)
	}
	if _, _, ok := mainLoop(nil); ok {
		t.Fatal("no zones chose a loop")
	}
}

func TestLoopEventNeedsItsBankAsADependency(t *testing.T) {
	data := make([]byte, loopOffBank+8)
	binary.LittleEndian.PutUint32(data[loopOffPlay:], 1234)
	binary.LittleEndian.PutUint32(data[loopOffBank:], 0xBB)
	tt := &testTag{deps: []testDep{{"sbnk", 0xBB}}}
	tt.link(0, tt.block(data), -1, 0)
	if ev, bank, ok := loopEvent(tt.parse(t)); !ok || ev != 1234 || bank != 0xBB {
		t.Fatalf("event %d bank %x ok %v", ev, bank, ok)
	}
	tt.deps = []testDep{{"sbnk", 0xCC}}
	if _, _, ok := loopEvent(tt.parse(t)); ok {
		t.Fatal("a bank that is not a dependency was followed")
	}
}

func TestManifestRoundTripAndStaleTakes(t *testing.T) {
	dir := t.TempDir()
	if built, _ := ManifestStatus(dir); built {
		t.Fatal("built without a manifest")
	}
	m := &Manifest{Version: ManifestVersion, Maps: map[string]Bed{
		"fo09_academy": {Loop: "5d6cc1cb", Zones: 2, Beds: 1, Takes: []Take{{File: takeName(880145009), Media: 880145009, DurationMs: 54784, Channels: 4}}},
	}}
	for _, name := range []string{takeName(880145009), takeName(1), "reload_00000001.ogg"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("OggS"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeManifest(dir, m); err != nil {
		t.Fatal(err)
	}
	removed, err := removeStaleTakes(dir, m)
	if err != nil || removed != 1 {
		t.Fatalf("removed %d (%v), want the one unlisted take", removed, err)
	}
	for name, want := range map[string]bool{takeName(880145009): true, takeName(1): false, "reload_00000001.ogg": true} {
		if _, err := os.Stat(filepath.Join(dir, name)); (err == nil) != want {
			t.Errorf("%s present = %v, want %v", name, err == nil, want)
		}
	}
	if built, stale := ManifestStatus(dir); !built || stale {
		t.Fatalf("built %v stale %v", built, stale)
	}
	got, err := ReadManifest(dir)
	if err != nil {
		t.Fatal(err)
	}
	if f, ok := got.BedFile("fo09_academy"); !ok || f != "ambience_3475f271.ogg" {
		t.Fatalf("bed file %q %v", f, ok)
	}
	if _, ok := got.BedFile("sgh_streets"); ok {
		t.Fatal("a map without a bed has a file")
	}
}
