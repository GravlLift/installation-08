// attachments.go — the effects a weapon attaches to markers of its model, and its object functions.
//
// The `attachments` block of a weap tag lists what the weapon carries: effects (`effe`) and
// looping sounds (`lsnd`), each at a marker, each scaled by a weapon function (its primary and
// secondary scale). The flag's banner is one: an effect per team at the flag's marker. The
// Shock Rifle's electricity is another, scaled by `fx_ready`. The `functions` block defines those
// functions: each exports a value read from an import (the weapon's `ready`, `is_reloading`...),
// inverted or not, and turned off when another function is 0.
//
// The blocks sit in the root struct after fields whose sizes the community weap plugin gets right;
// the block field is located like the aim-assist fields, by the run of the root block fields of
// the plugin's around the block. The element layout is the plugin's (its walked size must be the
// live element stride).

package weaponicons

import (
	"encoding/binary"
	"fmt"
	"math"
	"sync"
)

// EffectAttachment is an effect the weapon attaches at a marker of its model, scaled by two of the
// weapon's functions (StringIDs of their export names; 0: none).
type EffectAttachment struct {
	Effect         uint32
	Marker         uint32
	PrimaryScale   uint32
	SecondaryScale uint32
}

// ObjectFunction is one of the weapon's object functions (StringIDs; 0: none). Its value is the
// import's (Default when the object has no such import), inverted when Invert (flags bit 0), and
// 0 while the function named TurnOffWith is 0.
type ObjectFunction struct {
	Import      uint32
	Default     float32
	Export      uint32
	TurnOffWith uint32
	Invert      bool
}

// Plugin names of the fields read.
const (
	pathAttachments     = "item/object/attachments"
	pathFunctions       = "item/object/functions"
	fieldAttachType     = "type"
	fieldMarker         = "marker"
	fieldPrimaryScale   = "primary scale"
	fieldSecondaryScale = "secondary scale"
	fieldFlags          = "flags"
	fieldImport         = "import name"
	fieldNoImport       = "no import default"
	fieldExport         = "export name"
	fieldTurnOffWith    = "turn off with"
	// refGroupOff: the group FourCC of a `_41` reference, after its id (calibrated on the flag's
	// effect references, "effe" at +0x14 of the field).
	refGroupOff = 0x14
	groupEffect = "effe"
	// functionInvert: the plugin's function flags, bit 0 "invert".
	functionInvert = 1
)

// blockLayout is where a block field sits in the plugin root, the plugin offsets of the root block
// fields around it, and the element layout (stride, the offsets of the named fields).
type blockLayout struct {
	// run: the root block fields around the block, its own included (blocks[at]): the narrowest
	// window of them whose spacing the live root matches once (runs) is used.
	blocks []int
	rank   int
	field  int
	stride int
	at     map[string]int
}

var (
	loadAttachLayout = sync.OnceValues(func() (*blockLayout, error) {
		return blockLayoutOfPlugin(pathAttachments, fieldAttachType, fieldMarker, fieldPrimaryScale, fieldSecondaryScale)
	})
	loadFunctionLayout = sync.OnceValues(func() (*blockLayout, error) {
		return blockLayoutOfPlugin(pathFunctions, fieldFlags, fieldImport, fieldNoImport, fieldExport, fieldTurnOffWith)
	})
)

// blockLayoutOfPlugin reads the layout of the root block field `path` and the offsets of its
// fields `names` (the first field of each name).
func blockLayoutOfPlugin(path string, names ...string) (*blockLayout, error) {
	all, err := loadWeapPlugin()
	if err != nil {
		return nil, err
	}
	var blocks []int
	l := &blockLayout{field: -1, at: map[string]int{}}
	at := -1
	for _, f := range all {
		if !f.block {
			continue
		}
		if f.path == path && at < 0 {
			at, l.field = len(blocks), f.off
			var inner []pfield
			l.stride = walkFields(f.node, 0, &inner)
			for _, g := range inner {
				for _, n := range names {
					if _, seen := l.at[n]; g.name == n && !seen {
						l.at[n] = g.off
					}
				}
			}
		}
		blocks = append(blocks, f.off)
	}
	if at <= 0 || at+1 >= len(blocks) || len(l.at) != len(names) {
		return nil, fmt.Errorf("`%s` block or its fields absent from the plugin", path)
	}
	l.blocks, l.rank = blocks, at
	return l, nil
}

// elements resolves the block of layout l in tag: its records' absolute offsets (nil: no block).
func (l *blockLayout) elements(tag []byte) ([]int, error) {
	wt, err := openWeapTag(tag)
	if err != nil {
		return nil, err
	}
	root, err := wt.rootBlock()
	if err != nil {
		return nil, err
	}
	shift, err := l.shift(wt.rootBlockFields(root))
	if err != nil {
		return nil, err
	}
	blk := wt.childBlock(root, l.field+shift)
	if blk < 0 {
		return nil, nil
	}
	abs, size := wt.blockAbs(blk)
	if abs < 0 || abs+size > len(tag) || size%l.stride != 0 {
		return nil, fmt.Errorf("block of %d bytes, not a multiple of %d", size, l.stride)
	}
	var out []int
	for e := abs; e < abs+size; e += l.stride {
		out = append(out, e)
	}
	return out, nil
}

// shift is the offset of the live root's block fields from the plugin's at the block: the run of
// the block fields around it, widened one field on each side until the live fields match it once.
func (l *blockLayout) shift(live []int) (int, error) {
	var err error
	for w := 1; l.rank-w >= 0 && l.rank+w < len(l.blocks); w++ {
		var s int
		if s, err = runShift(l.blocks[l.rank-w:l.rank+w+1], live); err == nil {
			return s, nil
		}
	}
	return 0, err
}

// ReadEffectAttachments reads the effect attachments of one `weap` tag (its decompressed bytes),
// in block order. Attachments of another type (a looping sound) are left out.
func ReadEffectAttachments(tag []byte) ([]EffectAttachment, error) {
	l, err := loadAttachLayout()
	if err != nil {
		return nil, err
	}
	els, err := l.elements(tag)
	if err != nil {
		return nil, fmt.Errorf("attachments: %w", err)
	}
	u32 := func(o int) uint32 { return binary.LittleEndian.Uint32(tag[o:]) }
	var out []EffectAttachment
	for _, e := range els {
		t := e + l.at[fieldAttachType]
		// The FourCC lies as a little-endian word; "effe" reads the same either way.
		if string(tag[t+refGroupOff:t+refGroupOff+4]) != groupEffect {
			continue
		}
		out = append(out, EffectAttachment{
			Effect:         refGID(tag, t),
			Marker:         u32(e + l.at[fieldMarker]),
			PrimaryScale:   u32(e + l.at[fieldPrimaryScale]),
			SecondaryScale: u32(e + l.at[fieldSecondaryScale]),
		})
	}
	return out, nil
}

// ReadObjectFunctions reads the object functions of one `weap` tag, in block order.
func ReadObjectFunctions(tag []byte) ([]ObjectFunction, error) {
	l, err := loadFunctionLayout()
	if err != nil {
		return nil, err
	}
	els, err := l.elements(tag)
	if err != nil {
		return nil, fmt.Errorf("functions: %w", err)
	}
	u32 := func(o int) uint32 { return binary.LittleEndian.Uint32(tag[o:]) }
	out := make([]ObjectFunction, 0, len(els))
	for _, e := range els {
		out = append(out, ObjectFunction{
			Import:      u32(e + l.at[fieldImport]),
			Default:     math.Float32frombits(u32(e + l.at[fieldNoImport])),
			Export:      u32(e + l.at[fieldExport]),
			TurnOffWith: u32(e + l.at[fieldTurnOffWith]),
			Invert:      u32(e+l.at[fieldFlags])&functionInvert != 0,
		})
	}
	return out, nil
}

// childBlock is the block a TagBlock field at fieldOff of block parent points to, -1 when none.
func (w weapTag) childBlock(parent, fieldOff int) int {
	for i := 0; i < w.structs; i++ {
		b := w.structTab + i*0x20
		if binary.LittleEndian.Uint16(w.tag[b+0x10:]) != 1 ||
			int(int32(binary.LittleEndian.Uint32(w.tag[b+0x18:]))) != parent ||
			int(binary.LittleEndian.Uint32(w.tag[b+0x1C:])) != fieldOff {
			continue
		}
		return int(int32(binary.LittleEndian.Uint32(w.tag[b+0x14:])))
	}
	return -1
}
