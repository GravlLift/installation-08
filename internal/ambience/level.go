package ambience

// level.go reads, from a map's level tag (`levl`), the background sounds of its acoustic zones
// and chooses the map's main bed. The layout, measured on the level tags of eight multiplayer
// maps of the installed game (fo08_wetland, fo09_academy, fo11_blank, fo13_frost, ctf_aquarius,
// sgh_blueprint, sgh_interlock, sgh_streets):
//
//	root +0x3d0  background sound palette, 276 B per zone; a zone's looping sound (`lsnd`) is
//	             the tag reference at +0x28 of its entry, its sound environment (`snde`, the
//	             reverb) the one at +0x64
//
// The Forge maps have one or two zones; the native maps 34 to 71, naming 4 to 12 distinct loops
// (indoor rooms, outdoor areas). Another palette (root +0x1dc, 148 B per entry) places
// positional emitters; it is not read here.

import (
	"fmt"
	"sort"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
)

const (
	levelOffPalette = 0x3d0
	paletteStride   = 276
	paletteOffLoop  = 0x28
	structTagBlock  = 1
	groupLoop       = "lsnd"
)

// zoneLoop is one palette zone's background sound.
type zoneLoop struct {
	Zone int
	Loop uint32
}

// zoneLoops returns, in palette order, the zones of the level that name a background sound.
// A level without a palette has none.
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
			out = append(out, zoneLoop{Zone: r.FieldOffset / paletteStride, Loop: d.GlobalID})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Zone < out[j].Zone })
	return out, nil
}

// mainLoop chooses the map's bed: the background sound the most zones name, the earliest zone
// breaking a tie. It also returns how many distinct sounds the zones name; false without zones.
func mainLoop(zones []zoneLoop) (loop uint32, distinct int, ok bool) {
	count := map[uint32]int{}
	first := map[uint32]int{}
	for _, z := range zones {
		if _, seen := count[z.Loop]; !seen {
			first[z.Loop] = z.Zone
		}
		count[z.Loop]++
	}
	best := -1
	for l, n := range count {
		if best < 0 || n > count[loop] || (n == count[loop] && first[l] < first[loop]) {
			loop, best = l, n
		}
	}
	return loop, len(count), best > 0
}
