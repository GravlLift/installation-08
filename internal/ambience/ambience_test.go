// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package ambience

import (
	"encoding/binary"
	"math"
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
	palette int      // the palette block index, once testLevel has built one
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

// zoneShape gives a palette zone a floor polygon (a child block of its +0xac field) and a
// height at +0xd4, so zoneLoops reads a shape for it.
func (tt *testTag) zoneShape(zone int, floor, height float32, xy [][2]float32) {
	le := binary.LittleEndian
	pb := make([]byte, len(xy)*pointStride)
	for i, p := range xy {
		le.PutUint32(pb[i*pointStride:], math.Float32bits(p[0]))
		le.PutUint32(pb[i*pointStride+4:], math.Float32bits(p[1]))
		le.PutUint32(pb[i*pointStride+8:], math.Float32bits(floor))
	}
	pi := tt.block(pb)
	tt.link(structTagBlock, pi, tt.palette, zone*paletteStride+paletteOffPoly)
	le.PutUint32(tt.data[tt.blocks[tt.palette][1]+zone*paletteStride+paletteOffHeight:], math.Float32bits(height))
}

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
// zone 2 nothing but a sound environment, zone 3 loop B again. None carries a shape until a test
// adds one.
func testLevel(t *testing.T) *testTag {
	t.Helper()
	tt := &testTag{deps: []testDep{{"lsnd", 0xA}, {"lsnd", 0xB}, {"snde", 0xE}}}
	root := tt.block(make([]byte, levelOffPalette+24))
	tt.link(0, root, -1, 0)
	tt.palette = tt.block(make([]byte, 4*paletteStride))
	tt.link(structTagBlock, tt.palette, root, levelOffPalette)
	tt.ref(tt.palette, paletteOffLoop, 0)
	tt.ref(tt.palette, paletteStride+paletteOffLoop, 1)
	tt.ref(tt.palette, 2*paletteStride+0x64, 2)
	tt.ref(tt.palette, 3*paletteStride+paletteOffLoop, 1)
	tt.ref(root, paletteOffLoop, 0) // a reference outside the palette is not a zone
	return tt
}

func TestZoneLoopsReadsThePalette(t *testing.T) {
	got, err := zoneLoops(testLevel(t).parse(t))
	if err != nil {
		t.Fatal(err)
	}
	want := []zoneLoop{{Zone: 0, Loop: 0xA}, {Zone: 1, Loop: 0xB}, {Zone: 3, Loop: 0xB}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("zones %+v, want %+v", got, want)
	}
	loop, distinct, ok := fallbackLoop(got)
	if !ok || loop != 0xB || distinct != 2 {
		t.Fatalf("fallback loop %x (%d distinct, %v), want b of 2", loop, distinct, ok)
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

func TestZoneShapeParsing(t *testing.T) {
	tt := testLevel(t)
	tt.zoneShape(0, 0, 5, [][2]float32{{-10, -10}, {10, -10}, {10, 10}, {-10, 10}})
	tt.zoneShape(1, 1.5, 3, [][2]float32{{0, 0}, {2, 0}, {0, 2}})
	got, err := zoneLoops(tt.parse(t))
	if err != nil {
		t.Fatal(err)
	}
	z0 := got[0]
	if z0.Floor != 0 || z0.Height != 5 {
		t.Fatalf("zone 0 floor %v height %v, want 0 and 5", z0.Floor, z0.Height)
	}
	want := [][2]float64{{-10, -10}, {10, -10}, {10, 10}, {-10, 10}}
	if !reflect.DeepEqual(z0.Points, want) {
		t.Fatalf("zone 0 points %v, want %v", z0.Points, want)
	}
	z1 := got[1]
	if z1.Floor != 1.5 || z1.Height != 3 {
		t.Fatalf("zone 1 floor %v height %v, want 1.5 and 3", z1.Floor, z1.Height)
	}
	if len(z1.Points) != 3 {
		t.Fatalf("zone 1 %d points, want 3", len(z1.Points))
	}
	if got[2].Points != nil {
		t.Fatalf("zone 3 (no shape) has points %v", got[2].Points)
	}
}

func TestFallbackLoopPicksTheLargestVolume(t *testing.T) {
	zones := []zoneLoop{
		{Zone: 0, Loop: 0xA, Height: 5, Points: [][2]float64{{0, 0}, {4, 0}, {4, 4}, {0, 4}}}, // area 16, volume 80
		{Zone: 1, Loop: 0xB, Height: 100, Points: [][2]float64{{0, 0}, {2, 0}, {0, 2}}},       // area 2, volume 200
		{Zone: 2, Loop: 0xC, Height: 50}, // no shape: does not compete
	}
	loop, distinct, ok := fallbackLoop(zones)
	if !ok || loop != 0xB {
		t.Fatalf("largest volume: loop %x ok %v, want b", loop, ok)
	}
	if distinct != 3 {
		t.Fatalf("distinct %d, want 3", distinct)
	}
}

func TestFallbackLoopTieGoesToTheEarliestZone(t *testing.T) {
	zones := []zoneLoop{
		{Zone: 0, Loop: 0xA, Height: 10, Points: [][2]float64{{0, 0}, {2, 0}, {2, 2}, {0, 2}}}, // area 4, volume 40
		{Zone: 1, Loop: 0xB, Height: 10, Points: [][2]float64{{0, 0}, {2, 0}, {2, 2}, {0, 2}}}, // area 4, volume 40
	}
	loop, _, ok := fallbackLoop(zones)
	if !ok || loop != 0xA {
		t.Fatalf("tie: loop %x ok %v, want a (the earliest zone)", loop, ok)
	}
}

func TestFallbackLoopWithoutShapesFallsToMostZones(t *testing.T) {
	loop, distinct, ok := fallbackLoop([]zoneLoop{{Zone: 0, Loop: 0xC}, {Zone: 1, Loop: 0xD}, {Zone: 2, Loop: 0xD}, {Zone: 3, Loop: 0xC}})
	if !ok || loop != 0xC || distinct != 2 {
		t.Fatalf("no shape: loop %x %d %v, want c of 2", loop, distinct, ok)
	}
	if _, _, ok := fallbackLoop(nil); ok {
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
		"fo09_academy": {
			Loop:  "5d6cc1cb",
			Zones: 2, Beds: 2,
			Takes: []Take{{File: takeName(880145009), Media: 880145009, DurationMs: 54784, Channels: 4}},
			Loops: map[string][]Take{
				"5d6cc1cb": {{File: takeName(880145009), Media: 880145009, DurationMs: 54784, Channels: 4}},
				"0602311e": {{File: takeName(1), Media: 1, DurationMs: 1000, Channels: 4}},
			},
			Shapes: []Shape{{Zone: 0, Loop: "5d6cc1cb", Floor: 0, Height: 250, Points: [][2]float64{{-250, -250}, {250, 250}}}},
		},
	}}
	for _, name := range []string{takeName(880145009), takeName(1), takeName(2), "reload_00000001.ogg"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("OggS"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := writeManifest(dir, m); err != nil {
		t.Fatal(err)
	}
	// Both takes are listed (one under Takes, one under Loops) so only takeName(2) is removed.
	removed, err := removeStaleTakes(dir, m)
	if err != nil || removed != 1 {
		t.Fatalf("removed %d (%v), want only the unlisted take", removed, err)
	}
	for name, want := range map[string]bool{takeName(880145009): true, takeName(1): true, takeName(2): false, "reload_00000001.ogg": true} {
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
	// The layout serves the fallback loop, every loop's first take file, and the shapes.
	lay, ok := got.Layout("fo09_academy")
	if !ok || lay.Fallback != "5d6cc1cb" {
		t.Fatalf("layout fallback %q ok %v", lay.Fallback, ok)
	}
	if lay.Files["5d6cc1cb"] != "ambience_3475f271.ogg" || lay.Files["0602311e"] != takeName(1) {
		t.Fatalf("layout files %v", lay.Files)
	}
	if len(lay.Zones) != 1 || lay.Zones[0].Loop != "5d6cc1cb" || len(lay.Zones[0].Points) != 2 {
		t.Fatalf("layout zones %+v", lay.Zones)
	}
	if _, ok := got.Layout("sgh_streets"); ok {
		t.Fatal("a map without a bed has a layout")
	}
}
