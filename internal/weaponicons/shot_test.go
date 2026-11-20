// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weaponicons

import (
	"encoding/binary"
	"math"
	"testing"
)

// shotFixture lays out a synthetic `weap` tag: the root's block fields at the table's offsets
// moved by `shift` (fields added before them, as in the installed game), the barrels field
// pointing at one barrel whose projectile and firing effect are the given references.
type shotFixture struct {
	shift        int
	projectile   uint32
	projGroup    string
	firing       uint32
	barrelStride int
	noAnchors    bool
}

func putRef(b []byte, at int, id uint32, group string) {
	binary.LittleEndian.PutUint32(b[at+8:], id)
	g := []byte(group)
	// The FourCC is stored reversed (a little-endian word).
	copy(b[at+refGroupOff:], []byte{g[3], g[2], g[1], g[0]})
}

func (f shotFixture) build(t *testing.T) []byte {
	t.Helper()
	l, err := loadBarrelLayout()
	if err != nil {
		t.Fatal(err)
	}
	le := binary.LittleEndian
	blocks := weapRootBlockFields
	// The root's block fields, the barrel's firing effects, and its two distribution offset blocks.
	structs := 1 + len(blocks) + 3
	nBlocks := 3
	header := 0x50 + nBlocks*0x10 + structs*0x20
	rootLen := 0x1200 + f.shift
	stride := f.barrelStride
	if stride == 0 {
		stride = barrelStride
	}
	b := make([]byte, header+rootLen+stride+firingEffectStride)
	le.PutUint32(b[0:], 0x68736375)
	le.PutUint32(b[0x1c:], uint32(nBlocks))
	le.PutUint32(b[0x20:], uint32(structs))
	le.PutUint32(b[0x38:], uint32(header))
	// Blocks: the root, the barrel, the firing effect (all in the tag data section).
	for i, sz := range []int{rootLen, stride, firingEffectStride} {
		e := 0x50 + i*0x10
		le.PutUint32(b[e:], uint32(sz))
		le.PutUint16(b[e+6:], 1)
		off := []int{0, rootLen, rootLen + stride}[i]
		le.PutUint64(b[e+8:], uint64(off))
	}
	st := 0x50 + nBlocks*0x10
	for i, off := range blocks {
		e := st + (i+1)*0x20
		le.PutUint16(b[e+0x10:], 1)
		target := uint32(math.MaxUint32)
		if off == l.field {
			target = 1
		}
		le.PutUint32(b[e+0x14:], target)
		le.PutUint32(b[e+0x1C:], uint32(off+f.shift))
	}
	e := st + (len(blocks)+1)*0x20
	le.PutUint16(b[e+0x10:], 1)
	le.PutUint32(b[e+0x14:], 2)
	le.PutUint32(b[e+0x18:], 1)
	le.PutUint32(b[e+0x1C:], barrelOffFiringEffects)
	if !f.noAnchors {
		for i, off := range []int{barrelOffDirectionOffsets, barrelOffPositionOffsets} {
			e := st + (len(blocks)+2+i)*0x20
			le.PutUint16(b[e+0x10:], 1)
			le.PutUint32(b[e+0x14:], math.MaxUint32)
			le.PutUint32(b[e+0x18:], 1)
			le.PutUint32(b[e+0x1C:], uint32(off))
		}
	}
	barrel := header + rootLen
	le.PutUint32(b[barrel+barrelOffRoundsPerSecond:], math.Float32bits(60))
	le.PutUint32(b[barrel+barrelOffRoundsPerSecond+4:], math.Float32bits(60))
	le.PutUint16(b[barrel+barrelOffShotsPerFire:], 3)
	le.PutUint16(b[barrel+barrelOffShotsPerFire+2:], 3)
	le.PutUint32(b[barrel+barrelOffFireRecovery:], math.Float32bits(1))
	le.PutUint16(b[barrel+barrelOffProjectilesPerShot:], 1)
	putRef(b, barrel+barrelOffProjectile, f.projectile, f.projGroup)
	putRef(b, barrel+stride+firingOffEffect, f.firing, groupEffect)
	return b
}

// TestReadBarrelShot — the projectile, the firing effect and the burst are read from the barrel the struct
// table names, with or without fields added to the root before it.
func TestReadBarrelShot(t *testing.T) {
	for _, shift := range []int{0, 64} {
		s, err := ReadBarrelShot(shotFixture{shift: shift, projectile: 0x96555d72, projGroup: "proj", firing: 0x136580d8}.build(t))
		if err != nil {
			t.Fatalf("shift %d: %v", shift, err)
		}
		if s.Projectile != 0x96555d72 || s.FiringEffect != 0x136580d8 || s.ShotsPerFire != [2]int{3, 3} ||
			s.RoundsPerSecond != [2]float32{60, 60} || s.FireRecovery != 1 || s.ProjectilesPerShot != 1 || s.ErrorAngle != [2]float32{} {
			t.Fatalf("shift %d: %+v", shift, s)
		}
	}
}

// TestReadBarrelShotRefuses — a projectile reference of another group, and a barrel block whose
// size is not a whole number of live barrels, are errors, never values.
func TestReadBarrelShotRefuses(t *testing.T) {
	if _, err := ReadBarrelShot(shotFixture{projectile: 0x1234, projGroup: "effe", firing: 0x1}.build(t)); err == nil {
		t.Error("projectile of group effe: want an error")
	}
	if _, err := ReadBarrelShot(shotFixture{projectile: 0x1234, projGroup: "proj", firing: 0x1, barrelStride: 908}.build(t)); err == nil {
		t.Error("barrel of 908 bytes: want an error")
	}
	if _, err := ReadBarrelShot(shotFixture{projectile: 0x1234, projGroup: "proj", firing: 0x1, noAnchors: true}.build(t)); err == nil {
		t.Error("barrel without its distribution offset blocks: want an error")
	}
}
