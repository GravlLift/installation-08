// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
package main

import (
	"encoding/binary"
	"fmt"
	"os"
	"path/filepath"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

// forgeWeapon reads a typed weap reference from a Forge object definition.
func forgeWeapon(tag []byte) uint32 {
	var found uint32
	for i := 0; i+16 <= len(tag); i += 4 {
		if string(tag[i+12:i+16]) != "paew" {
			continue
		}
		id := binary.LittleEndian.Uint32(tag[i:])
		if found != 0 && found != id {
			return 0
		}
		found = id
	}
	return found
}

func openForgeWeapons() (*himap.ModuleIndex, error) {
	root, err := himap.DeployRoot()
	if err != nil {
		return nil, err
	}
	paths := []string{filepath.Join(root, "any", "globals", "forge", "forge_objects-rtx-new.module")}
	pc := filepath.Join(root, "pc", "globals", "forge", "forge_objects-rtx-new.module")
	if _, err := os.Stat(pc); err == nil {
		paths = append(paths, pc)
	}
	return himap.NewModuleIndex(paths...)
}

// placedWeaponCandidates joins film objects to their actual Forge weapon definitions.
func placedWeaponCandidates(variant *mapvar.Variant, pads, candidates []replay.WeaponPad, resolve func(uint32) uint32) ([]replay.WeaponPad, []replay.MapWeaponPadDTO) {
	if variant == nil {
		return pads, nil
	}
	var spots []replay.MapWeaponPadDTO
	used := make(map[int]bool)
	for _, c := range candidates {
		if _, ok := replay.PadWeaponFamilyKey(c.Weapon); !ok {
			continue
		}
		pos := mapvar.Vec3{X: float64(c.X), Y: float64(c.Y), Z: float64(c.Z)}
		duplicate := false
		for _, p := range pads {
			if p.Weapon == c.Weapon && mapvar.Dist3(pos, mapvar.Vec3{X: float64(p.X), Y: float64(p.Y), Z: float64(p.Z)}) < 0.01 {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		// shortcut: 1 cm covers this match's quantization, widen only with measured evidence.
		best, distance := -1, 0.01
		for i, o := range variant.Objects {
			if d := mapvar.Dist3(pos, o.Pos); !used[i] && d < distance {
				best, distance = i, d
			}
		}
		if best < 0 {
			continue
		}
		o := variant.Objects[best]
		id := resolve(uint32(o.TypeID))
		if id == 0 {
			continue
		}
		used[best] = true
		c.Weapon = fmt.Sprintf("0x%08X", id)
		spot := replay.MapWeaponPadDTO{X: c.X, Y: c.Y, Z: c.Z, Pad: len(pads), Family: "placed", Forward: axisOf(o.Forward), Up: axisOf(o.Up)}
		if o.Scale != nil {
			spot.Scale = []float32{float32(o.Scale.X), float32(o.Scale.Y), float32(o.Scale.Z)}
		}
		pads = append(pads, c)
		spots = append(spots, spot)
	}
	return pads, spots
}
