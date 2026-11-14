// attachments.go — THE EFFECTS A WEAPON ATTACHES TO ITS MODEL, read from its `weap` tag.
//
// The `attachments` block of the object root (weap.xml): per element a `type` tag reference and the
// `marker` of the model it sits at. The CTF flag attaches one banner effect per team permutation of
// its model this way (himap.BanniereEquipe reads the effects).
//
// The block field is located as aimassist.go locates its fields: the plugin's root offsets are
// stale, so the live offset comes from the unique run of live root block fields whose gaps match
// the plugin's around `attachments`. The element layout is the plugin's (its walked size must be
// the live element stride).

package weaponicons

import (
	"encoding/binary"
	"fmt"
	"sync"
)

// EffectAttachment is an effect the weapon attaches at a marker of its model.
type EffectAttachment struct {
	Effect uint32
	Marker uint32
}

// Plugin names of the fields read.
const (
	pathAttachments = "item/object/attachments"
	fieldAttachType = "type"
	fieldMarker     = "marker"
	// refGroupOff: the group FourCC of a `_41` reference, after its id (calibrated on the flag's
	// effect references, "effe" at +0x14 of the field).
	refGroupOff = 0x14
	groupEffect = "effe"
)

// attachLayout is where the attachments block field sits in the plugin root, the plugin offsets of
// the root block fields around it, and the element layout.
type attachLayout struct {
	run                     []int
	field                   int
	stride, typeOff, marker int
}

var loadAttachLayout = sync.OnceValues(attachLayoutOfPlugin)

func attachLayoutOfPlugin() (*attachLayout, error) {
	all, err := loadWeapPlugin()
	if err != nil {
		return nil, err
	}
	var blocks []int
	l := &attachLayout{field: -1, typeOff: -1, marker: -1}
	at := -1
	for _, f := range all {
		if !f.block {
			continue
		}
		if f.path == pathAttachments && at < 0 {
			at, l.field = len(blocks), f.off
			var inner []pfield
			l.stride = walkFields(f.node, 0, &inner)
			for _, g := range inner {
				switch {
				case g.name == fieldAttachType && l.typeOff < 0:
					l.typeOff = g.off
				case g.name == fieldMarker && l.marker < 0:
					l.marker = g.off
				}
			}
		}
		blocks = append(blocks, f.off)
	}
	if at <= 0 || at+1 >= len(blocks) || l.typeOff < 0 || l.marker < 0 {
		return nil, fmt.Errorf("`attachments` block or its fields absent from the plugin")
	}
	l.run = blocks[at-1 : at+2]
	return l, nil
}

// ReadEffectAttachments reads the effect attachments of one `weap` tag (its decompressed bytes),
// in block order. Attachments of another type (a looping sound) are left out.
func ReadEffectAttachments(tag []byte) ([]EffectAttachment, error) {
	l, err := loadAttachLayout()
	if err != nil {
		return nil, err
	}
	wt, err := openWeapTag(tag)
	if err != nil {
		return nil, err
	}
	root, err := wt.rootBlock()
	if err != nil {
		return nil, err
	}
	shift, err := runShift(l.run, wt.rootBlockFields(root))
	if err != nil {
		return nil, fmt.Errorf("attachments: %w", err)
	}
	blk := wt.childBlock(root, l.field+shift)
	abs, size := wt.blockAbs(blk)
	if blk < 0 {
		return nil, nil
	}
	if abs < 0 || abs+size > len(tag) || size%l.stride != 0 {
		return nil, fmt.Errorf("attachments block: %d bytes, not a multiple of %d", size, l.stride)
	}
	var out []EffectAttachment
	for e := abs; e < abs+size; e += l.stride {
		// The FourCC lies as a little-endian word; "effe" reads the same either way.
		if string(tag[e+l.typeOff+refGroupOff:e+l.typeOff+refGroupOff+4]) != groupEffect {
			continue
		}
		out = append(out, EffectAttachment{
			Effect: refGID(tag, e+l.typeOff),
			Marker: binary.LittleEndian.Uint32(tag[e+l.marker:]),
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
