// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import (
	"encoding/binary"
	"math"
	"testing"
)

// aimFixture describes a synthetic `weap` tag: the root's block fields at the plugin's offsets,
// those from the aim-assist run on moved by `shift` (fields added before it, as in the installed
// game), and the aim-assist values written at their live offsets.
type aimFixture struct {
	shift     int
	runSkew   int // extra move of the run's last block field only (a stretch whose layout changed)
	autoaim   float32
	bounds    [2]float32
	flags     byte
	levels    uint16
	magnifier [2]float32
}

func (f aimFixture) live(l *aimLayout, off int) int {
	if off >= l.run[0] {
		off += f.shift
	}
	return off
}

// build lays the tag out: ucsh header, one data block (the root), the struct table (the root,
// then one tag-block entry per root block field), then the root's bytes.
func (f aimFixture) build(t *testing.T) []byte {
	t.Helper()
	l, err := loadAimLayout()
	if err != nil {
		t.Fatal(err)
	}
	all, err := loadWeapPlugin()
	if err != nil {
		t.Fatal(err)
	}
	var blocks []int
	for _, p := range all {
		if p.block {
			blocks = append(blocks, p.off)
		}
	}
	structs := 1 + len(blocks)
	header := 0x50 + 0x10 + structs*0x20
	rootLen := 0x1200 + f.shift + f.runSkew
	b := make([]byte, header+rootLen)
	le := binary.LittleEndian
	le.PutUint32(b[0:], 0x68736375)
	le.PutUint32(b[0x1c:], 1)
	le.PutUint32(b[0x20:], uint32(structs))
	le.PutUint32(b[0x38:], uint32(header))
	le.PutUint32(b[0x50:], uint32(rootLen))
	le.PutUint16(b[0x56:], 1)
	st := 0x60
	for i, off := range blocks {
		e := st + (i+1)*0x20
		le.PutUint16(b[e+0x10:], 1)
		le.PutUint32(b[e+0x14:], math.MaxUint32)
		lo := f.live(l, off)
		if off == l.run[len(l.run)-1] {
			lo += f.runSkew
		}
		le.PutUint32(b[e+0x1C:], uint32(lo))
	}
	at := func(path string) int { return header + f.live(l, l.fields[path]) }
	le.PutUint32(b[at(pathAutoaimBase):], math.Float32bits(f.autoaim))
	le.PutUint32(b[at(pathAutoaimBnds):], math.Float32bits(f.bounds[0]))
	le.PutUint32(b[at(pathAutoaimBnds)+4:], math.Float32bits(f.bounds[1]))
	b[at(pathAimFlags)] = f.flags
	le.PutUint16(b[at(pathMagLevels):], f.levels)
	le.PutUint32(b[at(pathMagRange):], math.Float32bits(f.magnifier[0]))
	le.PutUint32(b[at(pathMagRange)+4:], math.Float32bits(f.magnifier[1]))
	return b
}

// TestReadAimAssistFollowsStructTable — the fields are read where the tag's struct table puts
// the bracketing block fields, with or without fields added to the root before them.
func TestReadAimAssistFollowsStructTable(t *testing.T) {
	for _, shift := range []int{0, 0x38} {
		f := aimFixture{shift: shift, autoaim: 18, bounds: [2]float32{0, 100}, levels: 1, magnifier: [2]float32{2, 2}}
		a, err := ReadAimAssist(f.build(t))
		if err != nil {
			t.Fatalf("shift %#x: %v", shift, err)
		}
		if a.AutoaimRange != 18 || !a.ScalesWithZoom || len(a.Magnifications) != 1 || a.Magnifications[0] != 2 {
			t.Fatalf("shift %#x: %+v, want range 18, scaled, one level at 2", shift, a)
		}
	}
}

// TestReadAimAssistZoomLevels — two levels zoom to the ends of the magnification range, none
// leaves no zoom, and the "do not scale for magnification" flag is reported.
func TestReadAimAssistZoomLevels(t *testing.T) {
	f := aimFixture{shift: 0x38, autoaim: 17, levels: 2, magnifier: [2]float32{4, 9}, flags: flagNoMagnificationScale}
	a, err := ReadAimAssist(f.build(t))
	if err != nil {
		t.Fatal(err)
	}
	if a.ScalesWithZoom || len(a.Magnifications) != 2 || a.Magnifications[0] != 4 || a.Magnifications[1] != 9 {
		t.Fatalf("%+v, want not scaled, levels 4 and 9", a)
	}
	f = aimFixture{autoaim: 15}
	if a, err = ReadAimAssist(f.build(t)); err != nil || len(a.Magnifications) != 0 {
		t.Fatalf("no zoom level: %+v, %v", a, err)
	}
	f = aimFixture{autoaim: 15, levels: 3, magnifier: [2]float32{2, 8}}
	if _, err := ReadAimAssist(f.build(t)); err == nil {
		t.Fatal("three zoom levels: want an error, got nil")
	}
}

// TestReadAimAssistRefuses — a stretch whose layout changed (a gap between the bracketing block
// fields differs from the plugin's) and a range outside its own bounds are errors, never values.
func TestReadAimAssistRefuses(t *testing.T) {
	f := aimFixture{shift: 0x38, runSkew: 4, autoaim: 18}
	if _, err := ReadAimAssist(f.build(t)); err == nil {
		t.Fatal("changed stretch: want an error, got nil")
	}
	f = aimFixture{autoaim: 30, bounds: [2]float32{0, 20}}
	if _, err := ReadAimAssist(f.build(t)); err == nil {
		t.Fatal("range outside its bounds: want an error, got nil")
	}
}
