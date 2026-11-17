// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package reloadsounds

// graph.go reads, from an animation graph tag (`jmad`), the sounds one animation posts and the
// frame each is posted at. The layout, measured on the Spartan's third-person graphs (000033ce,
// 6514a7e3) and on the weapons' first-person graphs of the installed game:
//
//	root +0x40   sound references, 24 B each: a block at +4 of 96-B entries, each naming a
//	             `snd!` tag by its global id at +8
//	root +0x434  resource groups, 20 B each: the group's exploded resource (struct type 3) at +4,
//	             whose root owns the members block (396 B per member)
//	member +0x24 sound events, 8 B each: i16 index into the sound references, i16 frame
//
// An animation names its resource group and member (himap.AnimationGraphe.Groupe, .Membre).

import (
	"encoding/binary"
	"fmt"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
)

const (
	graphOffSounds      = 0x40
	soundRefStride      = 24
	soundRefOffBlock    = 4
	soundEntryStride    = 96
	soundEntryOffTag    = 8
	graphOffGroups      = 0x434
	groupStride         = 20
	groupOffResource    = 4
	memberStride        = 396
	memberOffSounds     = 0x24
	soundEventStride    = 8
	tagBlockCountOffset = 16
	structTagBlock      = 1
	structResource      = 3
	// noSoundReference: the reference index of a sound event that names no sound.
	noSoundReference = -1
)

// postedSound is one sound event of an animation: the `snd!` tags of the referenced entry and
// the animation frame it is posted at.
type postedSound struct {
	Frame  int
	Sounds []uint32
}

// animationSounds returns the sound events of the animation stored as member `member` of
// resource group `group`, in the graph's order. An animation without sound events has none.
func animationSounds(t *announcer.Tag, group, member int) ([]postedSound, error) {
	root, err := rootBlock(t)
	if err != nil {
		return nil, err
	}
	refs, err := soundReferences(t, root)
	if err != nil {
		return nil, err
	}
	members, err := membersBlock(t, root, group)
	if err != nil {
		return nil, err
	}
	field := member*memberStride + memberOffSounds
	if member < 0 || field+tagBlockCountOffset+4 > len(t.Block(members)) {
		return nil, fmt.Errorf("reloadsounds: member %d outside its group", member)
	}
	b := t.Block(childBlock(t, members, field, structTagBlock))
	if len(b)%soundEventStride != 0 {
		return nil, fmt.Errorf("reloadsounds: sound events block of %d bytes", len(b))
	}
	var out []postedSound
	for o := 0; o < len(b); o += soundEventStride {
		ref := int(int16(binary.LittleEndian.Uint16(b[o:])))
		frame := int(int16(binary.LittleEndian.Uint16(b[o+2:])))
		if ref == noSoundReference {
			continue // an event that names no sound (the Cindershot's first-person graph has one)
		}
		if ref < 0 || ref >= len(refs) || frame < 0 {
			return nil, fmt.Errorf("reloadsounds: sound event (%d, frame %d) outside %d references", ref, frame, len(refs))
		}
		out = append(out, postedSound{Frame: frame, Sounds: refs[ref]})
	}
	return out, nil
}

// soundReferences returns, per sound reference of the graph, the `snd!` tags its entries name.
func soundReferences(t *announcer.Tag, root int) ([][]uint32, error) {
	table := childBlock(t, root, graphOffSounds, structTagBlock)
	b := t.Block(table)
	if len(b)%soundRefStride != 0 {
		return nil, fmt.Errorf("reloadsounds: sound references block of %d bytes", len(b))
	}
	sounds := map[uint32]bool{}
	for _, d := range t.Deps {
		if d.Group == announcer.GroupSound {
			sounds[d.GlobalID] = true
		}
	}
	out := make([][]uint32, len(b)/soundRefStride)
	for i := range out {
		entries := t.Block(childBlock(t, table, i*soundRefStride+soundRefOffBlock, structTagBlock))
		for o := 0; o+soundEntryStride <= len(entries); o += soundEntryStride {
			if id := binary.LittleEndian.Uint32(entries[o+soundEntryOffTag:]); sounds[id] {
				out[i] = append(out[i], id)
			}
		}
	}
	return out, nil
}

// membersBlock returns the members block of resource group `group`: the one child of the
// group's resource root whose size is a whole number of members.
func membersBlock(t *announcer.Tag, root, group int) (int, error) {
	groups := childBlock(t, root, graphOffGroups, structTagBlock)
	res := childBlock(t, groups, group*groupStride+groupOffResource, structResource)
	if group < 0 || res < 0 {
		return -1, fmt.Errorf("reloadsounds: no resource for group %d", group)
	}
	found := -1
	for _, s := range t.Structs {
		if s.FieldBlock != res || s.Type != structTagBlock || s.Target < 0 || s.Target >= len(t.Blocks) {
			continue
		}
		if size := t.Blocks[s.Target].Size; size > 0 && size%memberStride == 0 {
			if found >= 0 {
				return -1, fmt.Errorf("reloadsounds: group %d has two members blocks", group)
			}
			found = s.Target
		}
	}
	if found < 0 {
		return -1, fmt.Errorf("reloadsounds: group %d has no members block", group)
	}
	return found, nil
}

// rootBlock returns the block of the tag's root record.
func rootBlock(t *announcer.Tag) (int, error) {
	for _, s := range t.Structs {
		if s.FieldBlock == -1 && s.Target >= 0 {
			return s.Target, nil
		}
	}
	return -1, fmt.Errorf("reloadsounds: tag without a root record")
}

// childBlock returns the block a struct of type `typ` links to from (owner, field), or -1.
func childBlock(t *announcer.Tag, owner, field, typ int) int {
	for _, s := range t.Structs {
		if s.FieldBlock == owner && s.FieldOffset == field && s.Type == typ {
			return s.Target
		}
	}
	return -1
}
