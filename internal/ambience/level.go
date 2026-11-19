// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package ambience

// level.go reads, from a map's level tag (`levl`), the background sounds and volumes of its
// acoustic zones and chooses the map's fallback bed. The layout, measured on the level tags of
// the installed game's native maps (sgh_streets, sgh_interlock):
//
//	root +0x3d0  background sound palette, 276 B per zone. Entry z (bytes [z*276, z*276+276)):
//	  +0x28  tag reference to the zone's looping sound (`lsnd`); its sound environment (`snde`,
//	          the reverb, reverb.go) is the tag reference at +0x64. Some zones name no loop
//	          (reverb-only); they have no bed but keep their reverb.
//	  +0xac  a tag block whose child block holds the zone's floor polygon: N points of 12 B
//	          each, float32 little-endian x, y, z; z is the same for every point and is the
//	          zone's floor.
//	  +0xc0  a second tag block with the polygon's 4-corner bounding rectangle; not read.
//	  +0xd4  float32, the zone's height above its floor (the volume is the polygon extruded
//	          from the floor to floor + height).
//
// The Forge maps have one or two zones; the native maps 34 to 71, naming 4 to 12 distinct loops
// (indoor rooms, outdoor areas). Coordinates are game world units, the same frame as the film's
// player positions. Another palette (root +0x1dc, 148 B per entry) places positional emitters;
// it is not read here.

import (
	"encoding/binary"
	"fmt"
	"math"
	"sort"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
)

const (
	levelOffPalette  = 0x3d0
	paletteStride    = 276
	paletteOffLoop   = 0x28
	paletteOffEnv    = 0x64
	paletteOffPoly   = 0xac
	paletteOffHeight = 0xd4
	pointStride      = 12
	structTagBlock   = 1
	groupLoop        = "lsnd"
	groupEnv         = "snde"
)

// zoneLoop is one palette zone's background sound and, when the zone carries a readable floor
// polygon, its volume.
type zoneLoop struct {
	Zone   int
	Loop   uint32
	Floor  float64
	Height float64
	// Points is the floor polygon (x, y); empty when the zone has no readable shape.
	Points [][2]float64
}

// zoneLoops returns, in palette order, the zones of the level that name a background sound,
// each with its floor polygon and height when the zone carries a readable shape. A level
// without a palette has none.
func zoneLoops(t *announcer.Tag) ([]zoneLoop, error) {
	root := -1
	for _, s := range t.Structs {
		if s.FieldBlock == -1 && s.Target >= 0 {
			root = s.Target
			break
		}
	}
	if root < 0 {
		return nil, fmt.Errorf("ambience: level without a root record")
	}
	palette := -1
	for _, s := range t.Structs {
		if s.FieldBlock == root && s.FieldOffset == levelOffPalette && s.Type == structTagBlock {
			palette = s.Target
			break
		}
	}
	if palette < 0 || palette >= len(t.Blocks) {
		return nil, nil
	}
	if size := t.Blocks[palette].Size; size%paletteStride != 0 {
		return nil, fmt.Errorf("ambience: background sound palette of %d bytes", size)
	}
	var out []zoneLoop
	for _, r := range t.Refs {
		if r.FieldBlock != palette || r.FieldOffset%paletteStride != paletteOffLoop || r.Dep < 0 || r.Dep >= len(t.Deps) {
			continue
		}
		if d := t.Deps[r.Dep]; d.Group == groupLoop {
			zone := r.FieldOffset / paletteStride
			z := zoneLoop{Zone: zone, Loop: d.GlobalID}
			z.Points, z.Floor, z.Height = zoneShape(t, palette, zone)
			out = append(out, z)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Zone < out[j].Zone })
	return out, nil
}

// zoneShape reads one palette zone's floor polygon, floor and height. The polygon is the child
// block of the tag field at +0xac of the zone's entry; the height is the float at +0xd4. It
// returns empty points when the zone has no readable shape (missing child block, fewer than
// three points).
func zoneShape(t *announcer.Tag, palette, zone int) (points [][2]float64, floor, height float64) {
	entry := t.Block(palette)
	off := zone * paletteStride
	if entry == nil || off+paletteOffHeight+4 > len(entry) {
		return nil, 0, 0
	}
	height = float64(math.Float32frombits(binary.LittleEndian.Uint32(entry[off+paletteOffHeight:])))
	target := -1
	for _, s := range t.Structs {
		if s.FieldBlock == palette && s.FieldOffset == off+paletteOffPoly && s.Type == structTagBlock {
			target = s.Target
			break
		}
	}
	if target < 0 {
		return nil, 0, height
	}
	poly := t.Block(target)
	if poly == nil || len(poly) < 3*pointStride {
		return nil, 0, height
	}
	n := len(poly) / pointStride
	points = make([][2]float64, n)
	for i := range points {
		x := math.Float32frombits(binary.LittleEndian.Uint32(poly[i*pointStride:]))
		y := math.Float32frombits(binary.LittleEndian.Uint32(poly[i*pointStride+4:]))
		z := math.Float32frombits(binary.LittleEndian.Uint32(poly[i*pointStride+8:]))
		points[i] = [2]float64{float64(x), float64(y)}
		if i == 0 {
			floor = float64(z)
		}
	}
	return points, floor, height
}

// zoneEnv is one palette zone's sound environment (its reverb) and its shape.
type zoneEnv struct {
	Zone   int
	Env    uint32
	Floor  float64
	Height float64
	Points [][2]float64
}

// zoneEnvs returns, in palette order, the zones of the level that name a sound environment,
// each with its floor polygon and height when the zone carries a readable shape. Zones that name
// no loop (reverb-only rooms) are included. A level without a palette has none.
func zoneEnvs(t *announcer.Tag) []zoneEnv {
	root := -1
	for _, s := range t.Structs {
		if s.FieldBlock == -1 && s.Target >= 0 {
			root = s.Target
			break
		}
	}
	palette := -1
	for _, s := range t.Structs {
		if root >= 0 && s.FieldBlock == root && s.FieldOffset == levelOffPalette && s.Type == structTagBlock {
			palette = s.Target
			break
		}
	}
	if palette < 0 || palette >= len(t.Blocks) || t.Blocks[palette].Size%paletteStride != 0 {
		return nil
	}
	var out []zoneEnv
	for _, r := range t.Refs {
		if r.FieldBlock != palette || r.FieldOffset%paletteStride != paletteOffEnv || r.Dep < 0 || r.Dep >= len(t.Deps) {
			continue
		}
		if d := t.Deps[r.Dep]; d.Group == groupEnv {
			zone := r.FieldOffset / paletteStride
			z := zoneEnv{Zone: zone, Env: d.GlobalID}
			z.Points, z.Floor, z.Height = zoneShape(t, palette, zone)
			out = append(out, z)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Zone < out[j].Zone })
	return out
}

// polygonArea is the absolute shoelace area of a floor polygon.
func polygonArea(p [][2]float64) float64 {
	var sum float64
	for i := range p {
		a := p[i]
		b := p[(i+1)%len(p)]
		sum += a[0]*b[1] - a[1]*b[0]
	}
	if sum < 0 {
		sum = -sum
	}
	return sum / 2
}

// fallbackLoop chooses the map's fallback bed: the loop of the zone with the largest volume
// (the shoelace area of its floor polygon times its height); ties go to the earliest zone and
// zones without a shape do not compete. When no zone has a shape it falls back to the loop the
// most zones name. It also returns how many distinct loops the zones name; false without zones.
func fallbackLoop(zones []zoneLoop) (loop uint32, distinct int, ok bool) {
	count := map[uint32]int{}
	first := map[uint32]int{}
	for _, z := range zones {
		if _, seen := count[z.Loop]; !seen {
			first[z.Loop] = z.Zone
		}
		count[z.Loop]++
	}
	vol := -1
	for i := range zones {
		if zones[i].Points == nil {
			continue
		}
		if vol < 0 || polygonArea(zones[i].Points)*zones[i].Height > polygonArea(zones[vol].Points)*zones[vol].Height {
			vol = i
		}
	}
	if vol >= 0 {
		return zones[vol].Loop, len(count), true
	}
	best := -1
	for l, n := range count {
		if best < 0 || n > count[loop] || (n == count[loop] && first[l] < first[loop]) {
			loop, best = l, n
		}
	}
	return loop, len(count), best > 0
}
