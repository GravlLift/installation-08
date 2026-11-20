// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// shot.go — what a weapon's barrel fires: its projectile and its firing effect.
//
// The `barrels` block of a weap tag describes each barrel: its rate of fire, its error, the
// projectile it fires (`proj`) and its firing effects (a block whose element's first reference is
// the firing effect, `effe`, played at the weapon's markers on each shot). The Shock Rifle's barrel
// fires proj 96555d72 and plays effe 136580d8.
//
// The block field is located like the other root blocks (weaplayout.go: the run of the root block
// fields around it). The element offsets are the live tag's, not the reference layout's: the live
// barrel is 928 bytes where the reference lays out 908, its fields shifted after the first block
// fields. They were measured on the installed game (2026-11-20) by aligning the reference layout's
// block and reference fields on the live tag's own struct and tag-reference tables (every Shock
// Rifle variant: 1a22fee6, 9387a8b9, 9ee5ff15), and every read checks the group of what it reads,
// refusing anything else.
//
// THE FIRING (measured 2026-11-20 on the same tags, raw barrel bytes against the reference order):
//
//	+0    flags (int32)                          0x200
//	+4    firing/rounds per second (real bounds) 60, 60
//	+56   firing/shots per fire (short bounds)   3, 3: a trigger pull fires a burst of three
//	+60   firing/fire recovery time (s)          1
//	+90   rounds per shot (short)                1 (one round of the magazine per projectile)
//	+140  projectile distribution/function       0 "point"
//	+142  projectile distribution/projectiles per shot (short)  1
//	+144  projectile distribution/direction offset (block, empty)   anchors
//	+164  projectile distribution/position offsets (block, empty)
//	+216  projectile error/error angle (angle bounds, radians)  0, 0: no spread
//
// The fields from +0 to +80 follow the reference order with no field added; the reference's
// first four fields after +80 sit four bytes later (a field was added at +84); the distribution
// and error fields are placed from the two block fields the struct table names at +144 and +164
// (checked on every read: a barrel without them is refused).

package weaponicons

import (
	"encoding/binary"
	"fmt"
	"math"
	"sync"
)

// Names of the barrel fields read.
const (
	pathBarrels = "barrels"
	// barrelStride: a live barrel's size; barrelOffProjectile: its projectile reference;
	// barrelOffFiringEffects: its firing effects block (784 bytes an element, the firing effect's
	// reference at +4, after the shot count bounds).
	barrelStride           = 928
	barrelOffProjectile    = 460
	barrelOffFiringEffects = 768
	firingEffectStride     = 784
	firingOffEffect        = 4
	groupProjectile        = "proj"
	// The firing fields (see the header).
	barrelOffRoundsPerSecond    = 4
	barrelOffShotsPerFire       = 56
	barrelOffFireRecovery       = 60
	barrelOffProjectilesPerShot = 142
	barrelOffDirectionOffsets   = 144
	barrelOffPositionOffsets    = 164
	barrelOffErrorAngle         = 216
)

var loadBarrelLayout = sync.OnceValues(func() (*blockLayout, error) { return weapBlockLayout(pathBarrels) })

// BarrelShot is what a weapon's first barrel fires: its projectile and its firing effect (tag
// GlobalIDs; 0: none).
type BarrelShot struct {
	Projectile   uint32
	FiringEffect uint32
	// RoundsPerSecond: the barrel's rate of fire bounds (the spacing of a burst's shots);
	// ShotsPerFire: the shots one trigger pull fires (bounds); FireRecovery: seconds before the
	// next pull; ProjectilesPerShot: projectiles per shot; ErrorAngle: the projectile error bounds
	// (radians).
	RoundsPerSecond    [2]float32
	ShotsPerFire       [2]int
	FireRecovery       float32
	ProjectilesPerShot int
	ErrorAngle         [2]float32
}

// refOfGroup reads the tag reference at abs when it names a tag of group `group` (0: a null
// reference); an error for a reference of another group.
func refOfGroup(tag []byte, abs int, group string) (uint32, error) {
	if abs < 0 || abs+refGroupOff+4 > len(tag) {
		return 0, fmt.Errorf("reference at %d out of bounds", abs)
	}
	id := refGID(tag, abs)
	if id == 0xffffffff || id == 0 {
		return 0, nil
	}
	// The FourCC lies reversed (a little-endian word); a group of four distinct letters reads backwards.
	g := tag[abs+refGroupOff : abs+refGroupOff+4]
	if got := string([]byte{g[3], g[2], g[1], g[0]}); got != group && string(g) != group {
		return 0, fmt.Errorf("reference at %d names a %q, %q expected", abs, got, group)
	}
	return id, nil
}

// ReadBarrelShot reads what the first barrel of one `weap` tag fires. A weapon without barrels
// answers a zero BarrelShot.
func ReadBarrelShot(tag []byte) (BarrelShot, error) {
	l, err := loadBarrelLayout()
	if err != nil {
		return BarrelShot{}, err
	}
	wt, err := openWeapTag(tag)
	if err != nil {
		return BarrelShot{}, err
	}
	root, err := wt.rootBlock()
	if err != nil {
		return BarrelShot{}, err
	}
	shift, err := l.shift(wt.rootBlockFields(root))
	if err != nil {
		return BarrelShot{}, fmt.Errorf("barrels: %w", err)
	}
	blk := wt.childBlock(root, l.field+shift)
	if blk < 0 {
		return BarrelShot{}, nil
	}
	abs, size := wt.blockAbs(blk)
	if abs < 0 || abs+size > len(tag) || size%barrelStride != 0 {
		return BarrelShot{}, fmt.Errorf("barrels: block of %d bytes, not a multiple of %d", size, barrelStride)
	}
	if size == 0 {
		return BarrelShot{}, nil
	}
	var out BarrelShot
	if out.Projectile, err = refOfGroup(tag, abs+barrelOffProjectile, groupProjectile); err != nil {
		return BarrelShot{}, fmt.Errorf("barrel projectile: %w", err)
	}
	if !wt.hasBlockField(blk, barrelOffDirectionOffsets) || !wt.hasBlockField(blk, barrelOffPositionOffsets) {
		return BarrelShot{}, fmt.Errorf("barrel: no distribution offset blocks at +%d and +%d (layout moved)", barrelOffDirectionOffsets, barrelOffPositionOffsets)
	}
	le := binary.LittleEndian
	f32 := func(o int) float32 { return math.Float32frombits(le.Uint32(tag[abs+o:])) }
	i16 := func(o int) int { return int(int16(le.Uint16(tag[abs+o:]))) }
	out.RoundsPerSecond = [2]float32{f32(barrelOffRoundsPerSecond), f32(barrelOffRoundsPerSecond + 4)}
	out.ShotsPerFire = [2]int{i16(barrelOffShotsPerFire), i16(barrelOffShotsPerFire + 2)}
	out.FireRecovery = f32(barrelOffFireRecovery)
	out.ProjectilesPerShot = i16(barrelOffProjectilesPerShot)
	out.ErrorAngle = [2]float32{f32(barrelOffErrorAngle), f32(barrelOffErrorAngle + 4)}
	for _, v := range []float32{out.RoundsPerSecond[0], out.RoundsPerSecond[1], out.FireRecovery, out.ErrorAngle[0], out.ErrorAngle[1]} {
		if math.IsNaN(float64(v)) || math.IsInf(float64(v), 0) || v < 0 || v > 1e4 {
			return BarrelShot{}, fmt.Errorf("barrel firing: %g out of range (layout moved)", v)
		}
	}
	if out.ShotsPerFire[0] < 0 || out.ShotsPerFire[1] < out.ShotsPerFire[0] || out.ShotsPerFire[1] > 64 {
		return BarrelShot{}, fmt.Errorf("barrel shots per fire %v out of range (layout moved)", out.ShotsPerFire)
	}
	fx := wt.childBlock(blk, barrelOffFiringEffects)
	if fx < 0 {
		return out, nil
	}
	fAbs, fSize := wt.blockAbs(fx)
	if fAbs < 0 || fAbs+fSize > len(tag) || fSize%firingEffectStride != 0 {
		return BarrelShot{}, fmt.Errorf("firing effects: block of %d bytes, not a multiple of %d", fSize, firingEffectStride)
	}
	if fSize > 0 {
		if out.FiringEffect, err = refOfGroup(tag, fAbs+firingOffEffect, groupEffect); err != nil {
			return BarrelShot{}, fmt.Errorf("firing effect: %w", err)
		}
	}
	return out, nil
}
