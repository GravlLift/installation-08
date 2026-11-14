// aimassist.go — THE RED-RETICLE REACH OF A WEAPON, read from its `weap` tag.
//
// The reticle turns red when the target is inside the weapon's AUTOAIM RANGE: the
// `Base Value` of `autoaim range` in the root's inline `aim assist` struct (weap.xml, the
// struct after the `aim assist modes` block). That block is the plugin's "aim assist
// deprecated" section: it is all zero in most installed weapons, so it is not read.
//
// While zoomed the range scales with the zoom's magnification unless the struct's flags set
// "do not scale for magnification". The magnification of each zoom level comes from the root's
// `magnification levels` and `magnification range` fields.
//
// INVARIANT (why the schema's root offsets are not used as is). The installed game has added
// fields to the `weap` root since the plugin was dumped, so the plugin's absolute root offsets
// are stale. The tag's struct table gives the LIVE offset of every block field of the root.
// A stretch of the root between consecutive block fields keeps the plugin's layout exactly when
// the live gaps between those block fields equal the plugin's gaps. So the fields read here are
// located from the live offset of the block fields that bracket them (`melee damage parameters`,
// `aim assist modes`, `target tracking`), found as the unique run of live block fields whose gaps
// match the plugin's. If the run is absent or ambiguous (a later patch changed that stretch),
// the read is an error, never a guess.

package weaponicons

import (
	"encoding/binary"
	"fmt"
	"math"
	"sort"
	"sync"
)

// AimAssist is the red-reticle data of one weapon.
type AimAssist struct {
	// AutoaimRange is the unscoped autoaim range, world units (1 wu = 3.048 m); 0 = none.
	AutoaimRange float64
	// Magnifications is each zoom level's magnification (index = level - 1); empty when the
	// tag declares no zoom level.
	Magnifications []float64
	// ScalesWithZoom is false when the tag sets "do not scale for magnification".
	ScalesWithZoom bool
}

// Plugin paths of the fields read, and the block fields that bracket them.
const (
	pathMagLevels   = "magnification levels"
	pathMagRange    = "magnification range"
	pathAimFlags    = "aim assist/flags"
	pathAutoaimBase = "aim assist/autoaim range/Base Value"
	pathAutoaimBnds = "aim assist/autoaim range/Value Bounds"
)

// flagNoMagnificationScale: bit 0 of the aim assist flags, "do not scale for magnification".
const flagNoMagnificationScale = 1

// maxZoomLevels bounds a plausible `magnification levels` value; beyond it the read is refused.
const maxZoomLevels = 8

// maxAutoaimRange bounds a plausible autoaim range (world units); beyond it the read is refused.
const maxAutoaimRange = 1000

// aimLayout is where the fields read sit in the PLUGIN's root offsets, and the plugin offsets
// of the root block fields from the one before the first field to the one after the last.
type aimLayout struct {
	fields map[string]int
	run    []int
}

// loadAimLayout derives the aim-assist layout from the embedded plugin, once.
var loadAimLayout = sync.OnceValues(aimLayoutOfPlugin)

func aimLayoutOfPlugin() (*aimLayout, error) {
	all, err := loadWeapPlugin()
	if err != nil {
		return nil, err
	}
	l := &aimLayout{fields: map[string]int{}}
	var blocks []int
	for _, f := range all {
		if f.block {
			blocks = append(blocks, f.off)
		}
		switch f.path {
		case pathMagLevels, pathMagRange, pathAimFlags, pathAutoaimBase, pathAutoaimBnds:
			l.fields[f.path] = f.off
		}
	}
	if len(l.fields) != 5 {
		return nil, fmt.Errorf("aim assist fields absent from the plugin (%d of 5)", len(l.fields))
	}
	lo, hi := math.MaxInt, -1
	for _, off := range l.fields {
		lo, hi = min(lo, off), max(hi, off)
	}
	first, last := -1, -1
	for i, b := range blocks {
		if b < lo {
			first = i
		}
		if b > hi && last < 0 {
			last = i
		}
	}
	if first < 0 || last < 0 {
		return nil, fmt.Errorf("aim assist fields not bracketed by root block fields")
	}
	l.run = blocks[first : last+1]
	return l, nil
}

// rootBlockFields returns the live offsets of the root's block fields, sorted.
func (w weapTag) rootBlockFields(root int) []int {
	var offs []int
	seen := map[int]bool{}
	for i := 0; i < w.structs; i++ {
		b := w.structTab + i*0x20
		if binary.LittleEndian.Uint16(w.tag[b+0x10:]) != 1 ||
			int(int32(binary.LittleEndian.Uint32(w.tag[b+0x18:]))) != root {
			continue
		}
		fo := int(binary.LittleEndian.Uint32(w.tag[b+0x1C:]))
		if !seen[fo] {
			seen[fo] = true
			offs = append(offs, fo)
		}
	}
	sort.Ints(offs)
	return offs
}

// runShift finds the unique run of consecutive live offsets whose gaps equal the plugin run's,
// and returns live minus plugin offset for that stretch.
func runShift(run, live []int) (int, error) {
	found, shift := 0, 0
	for i := 0; i+len(run) <= len(live); i++ {
		match := true
		for j := 1; j < len(run) && match; j++ {
			match = live[i+j]-live[i+j-1] == run[j]-run[j-1]
		}
		if match {
			found++
			shift = live[i] - run[0]
		}
	}
	if found != 1 {
		return 0, fmt.Errorf("aim assist stretch of the root: %d matching runs of block fields, want 1", found)
	}
	return shift, nil
}

// ReadAimAssist reads the red-reticle data of one `weap` tag (its decompressed bytes).
func ReadAimAssist(tag []byte) (AimAssist, error) {
	l, err := loadAimLayout()
	if err != nil {
		return AimAssist{}, err
	}
	wt, err := openWeapTag(tag)
	if err != nil {
		return AimAssist{}, err
	}
	root, err := wt.rootBlock()
	if err != nil {
		return AimAssist{}, err
	}
	abs, size := wt.blockAbs(root)
	if abs < 0 || abs+size > len(tag) {
		return AimAssist{}, fmt.Errorf("root block out of bounds")
	}
	shift, err := runShift(l.run, wt.rootBlockFields(root))
	if err != nil {
		return AimAssist{}, err
	}
	at := func(path string, n int) (int, error) {
		o := abs + l.fields[path] + shift
		if o < abs || o+n > abs+size {
			return 0, fmt.Errorf("field %q out of the root block", path)
		}
		return o, nil
	}
	return readAimFields(tag, at)
}

// readAimFields reads and checks the fields once located (`at` gives a field's tag offset).
func readAimFields(tag []byte, at func(string, int) (int, error)) (AimAssist, error) {
	f32 := func(o int) float64 { return float64(math.Float32frombits(binary.LittleEndian.Uint32(tag[o:]))) }
	var offs [5]int
	for i, p := range []struct {
		path string
		n    int
	}{{pathAutoaimBase, 4}, {pathAutoaimBnds, 8}, {pathAimFlags, 1}, {pathMagLevels, 2}, {pathMagRange, 8}} {
		o, err := at(p.path, p.n)
		if err != nil {
			return AimAssist{}, err
		}
		offs[i] = o
	}
	r, lo, hi := f32(offs[0]), f32(offs[1]), f32(offs[1]+4)
	if math.IsNaN(r) || r < 0 || r > maxAutoaimRange || ((lo != 0 || hi != 0) && (r < lo || r > hi)) {
		return AimAssist{}, fmt.Errorf("autoaim range %g outside its bounds [%g, %g]", r, lo, hi)
	}
	out := AimAssist{AutoaimRange: r, ScalesWithZoom: tag[offs[2]]&flagNoMagnificationScale == 0}
	mags, err := zoomMagnifications(int(binary.LittleEndian.Uint16(tag[offs[3]:])), f32(offs[4]), f32(offs[4]+4))
	if err != nil {
		return AimAssist{}, err
	}
	out.Magnifications = mags
	return out, nil
}

// zoomMagnifications is each zoom level's magnification. One level zooms to the low end of the
// magnification range, two levels to its two ends. More levels are refused: how the game spreads
// them over the range is not established from the installed data (no weapon declares more than
// two).
//
// EVIDENCE (installed chasm, every weapon with a zoom level, read from the tag's own
// `magnification range`): for EVERY one-level weapon the low and high ends are equal (lo == hi)
// — the Shock Rifle and both Bandits read [1, 1], the BR75 [2, 2], the Commando [1.5, 1.5], the
// S7 [4, 4]. So "one level zooms to the low end" and "to the high end" are the same read; the
// low-end rule is confirmed, not a coincidence. A one-level weapon whose range is [1, 1]
// genuinely declares no magnification above 1 in the tag (the Shock Rifle's real scope and the
// Bandits' light zoom come from a field this library does not read), so the view restores a named
// hand fallback for exactly those keys — see the web scope table, not here.
func zoomMagnifications(levels int, lo, hi float64) ([]float64, error) {
	switch {
	case levels == 0:
		return nil, nil
	case levels > maxZoomLevels || math.IsNaN(lo) || math.IsNaN(hi) || lo < 1 || hi < lo:
		return nil, fmt.Errorf("zoom: %d levels over magnification [%g, %g]", levels, lo, hi)
	case levels == 1:
		return []float64{lo}, nil
	case levels == 2:
		return []float64{lo, hi}, nil
	}
	return nil, fmt.Errorf("zoom: %d levels, per-level magnification not established past two", levels)
}
