// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package wwise

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// HIRC object types (Wwise nomenclature) this package interprets.
const (
	HircSound     = 2
	HircAction    = 3
	HircEvent     = 4
	HircRandomSeq = 5
	HircSwitch    = 6
	HircActorMix  = 7
	HircLayer     = 9
)

// HircObject is one raw object of a bank hierarchy: its type, its id and its body (after the id).
type HircObject struct {
	Type byte
	ID   uint32
	Body []byte
}

// Node properties (v135 AkPropID) this package reads from a node's property bundle.
const (
	PropVolume        = 0x00 // dB
	PropAttenuationID = 0x46 // u32: the attenuation (HIRC type 14) the node and its children use
	// PropGameAuxSend is the node's game-defined auxiliary send volume, dB: how much of the voice
	// feeds the reverb of the zone the game routes it to. It adds along the chain like the volume
	// (inferred from the volume's additivity, which the extracted levels confirm).
	PropGameAuxSend = 0x17
)

// nodeParams reads the direct parent and authored volume of a v135 node.
func nodeParams(o HircObject) (uint32, float64, bool) {
	parent, props, ok := nodeProps(o)
	if !ok {
		return 0, 0, false
	}
	var volume float64
	if v, ok := props[PropVolume]; ok {
		volume = float64(math.Float32frombits(v))
	}
	return parent, volume, true
}

// nodeProps reads the direct parent and the property bundle (id to raw 32-bit value) of a v135
// node.
func nodeProps(o HircObject) (uint32, map[byte]uint32, bool) {
	off := 0
	switch o.Type {
	case HircSound:
		off = 14
	case HircRandomSeq, HircSwitch, HircActorMix, HircLayer:
	default:
		return 0, nil, false
	}
	b := o.Body
	if len(b)-off < 2 {
		return 0, nil, false
	}
	nfx := int(b[off+1])
	off += 2
	if nfx > 0 {
		off += 1 + nfx*7
	}
	if off > len(b) || len(b)-off < 11 {
		return 0, nil, false
	}
	parent := binary.LittleEndian.Uint32(b[off+5:])
	off += 10
	n := int(b[off])
	off++
	if n > 64 || len(b)-off < n*5 {
		return 0, nil, false
	}
	props := make(map[byte]uint32, n)
	for i := 0; i < n; i++ {
		props[b[off+i]] = binary.LittleEndian.Uint32(b[off+n+i*4:])
	}
	return parent, props, true
}

// EventMediaGains returns authored node volume sums in dB for the event's media.
func (bk *Bank) EventMediaGains(eventID uint32) map[uint32]float64 {
	out := map[uint32]float64{}
	for id, m := range bk.EventMediaMix(eventID) {
		out[id] = m.GainDB
	}
	return out
}

// MediaMix is what a media's node chain (the sound, its containers, its actor-mixers) authors
// for its playback.
type MediaMix struct {
	// GainDB is the sum of the chain's node volumes.
	GainDB float64
	// Attenuation is the id of the distance attenuation the media plays with: the one the nearest
	// node of the chain names (a child's overrides its parents'); 0 when none does.
	Attenuation uint32
	// GameAuxSendDB is the sum of the chain's game-defined auxiliary send volumes: the level, against
	// the voice, at which it feeds the zone reverb (the Bandit's first-person shot: -60, its
	// third-person layers: +18).
	GameAuxSendDB float64
}

// EventMediaMix returns, for each media the event plays, its node chain's mix.
func (bk *Bank) EventMediaMix(eventID uint32) map[uint32]MediaMix {
	out := map[uint32]MediaMix{}
	ev, ok := bk.Objects[eventID]
	if !ok || ev.Type != HircEvent {
		return out
	}
	seen := map[uint32]bool{}
	var walk func(uint32)
	walk = func(id uint32) {
		if seen[id] {
			return
		}
		seen[id] = true
		o, ok := bk.object(id)
		if !ok {
			return
		}
		if o.Type != HircSound {
			for _, child := range bk.children(o.Body) {
				walk(child)
			}
			return
		}
		if len(o.Body) < 9 {
			return
		}
		media := binary.LittleEndian.Uint32(o.Body[5:])
		if media == 0 {
			return
		}
		if _, exists := out[media]; exists {
			return
		}
		var mix MediaMix
		parents := map[uint32]bool{}
		for {
			if parents[o.ID] {
				break
			}
			parents[o.ID] = true
			parent, props, ok := nodeProps(o)
			if !ok {
				break
			}
			if v, ok := props[PropVolume]; ok {
				mix.GainDB += float64(math.Float32frombits(v))
			}
			if v, ok := props[PropGameAuxSend]; ok {
				mix.GameAuxSendDB += float64(math.Float32frombits(v))
			}
			if a, ok := props[PropAttenuationID]; ok && mix.Attenuation == 0 {
				mix.Attenuation = a
			}
			if parent == 0 {
				break
			}
			o, ok = bk.object(parent)
			if !ok {
				break
			}
		}
		out[media] = mix
	}
	for _, act := range bk.eventActions(ev.Body) {
		if target, ok := bk.playTarget(act); ok {
			walk(target)
		}
	}
	return out
}

// Bank is a parsed sound bank: its header, its embedded media index and its hierarchy.
type Bank struct {
	Version uint32
	ID      uint32
	// Embedded maps an embedded media id to its bytes inside the DATA chunk.
	Embedded map[uint32][]byte
	Objects  map[uint32]HircObject
	Order    []uint32
	// linked, when set, holds hierarchy objects of sibling banks, resolved after this bank's
	// own (LinkObjects): an event's Play actions can target containers the runtime loads in a
	// bank of their own.
	linked map[uint32]HircObject
}

// object looks an id up in this bank's objects, then in its linked siblings' (the own bank wins).
func (bk *Bank) object(id uint32) (HircObject, bool) {
	if o, ok := bk.Objects[id]; ok {
		return o, true
	}
	if o, ok := bk.linked[id]; ok {
		return o, true
	}
	return HircObject{}, false
}

// LinkObjects makes the hierarchy walks of this bank also resolve the given tables' object ids
// (the tables of sibling banks whose containers an event here plays). Ids this bank itself has
// keep their own object.
func (bk *Bank) LinkObjects(tables ...map[uint32]HircObject) {
	for _, t := range tables {
		for id, o := range t {
			if _, own := bk.Objects[id]; !own {
				if bk.linked == nil {
					bk.linked = map[uint32]HircObject{}
				}
				bk.linked[id] = o
			}
		}
	}
}

// IndexBKHD returns the offset of the bank header in b (a bank may be wrapped in a tag), or -1.
func IndexBKHD(b []byte) int {
	return bytes.Index(b, []byte("BKHD"))
}

// bankChunks splits a bank into its chunks {magic: payload}.
func bankChunks(b []byte) map[string][]byte {
	out := map[string][]byte{}
	for off := 0; off+8 <= len(b); {
		magic := string(b[off : off+4])
		size := int(binary.LittleEndian.Uint32(b[off+4:]))
		start := off + 8
		if size < 0 || start+size > len(b) {
			break
		}
		out[magic] = b[start : start+size]
		off = start + size
	}
	return out
}

// ParseBank parses a bank starting at its BKHD chunk.
func ParseBank(b []byte) (*Bank, error) {
	ch := bankChunks(b)
	head, ok := ch["BKHD"]
	if !ok || len(head) < 8 {
		return nil, errors.New("wwise: bank without BKHD")
	}
	bk := &Bank{
		Version:  binary.LittleEndian.Uint32(head),
		ID:       binary.LittleEndian.Uint32(head[4:]),
		Embedded: map[uint32][]byte{},
		Objects:  map[uint32]HircObject{},
	}
	if didx, ok := ch["DIDX"]; ok {
		data := ch["DATA"]
		for o := 0; o+12 <= len(didx); o += 12 {
			id := binary.LittleEndian.Uint32(didx[o:])
			off := int(binary.LittleEndian.Uint32(didx[o+4:]))
			size := int(binary.LittleEndian.Uint32(didx[o+8:]))
			if off+size <= len(data) {
				bk.Embedded[id] = data[off : off+size]
			}
		}
	}
	if h, ok := ch["HIRC"]; ok {
		if err := bk.readHirc(h); err != nil {
			return nil, err
		}
	}
	return bk, nil
}

// soundActionTypes are the action types, read as the high byte of the action's type word, that
// make a sound heard: a Play (0x04) and the 0x01 variant an event can use to reach its per-take
// containers (measured on the slide_outof movement sound, whose event plays one such container
// per take, each in a bank of its own). The other action types (stop, state, ...) do not.
var soundActionTypes = map[byte]bool{0x04: true, 0x01: true}

// isSoundAction reports whether a parsed action is one of the sound-producing types.
func isSoundAction(b []byte) bool {
	return len(b) >= 6 && soundActionTypes[byte(binary.LittleEndian.Uint16(b)>>8)]
}

// EventMedia returns the media ids an event plays: Event -> its sound actions -> their target ->
// (through containers) -> Sound -> source id. The ids are in hierarchy order, without repeats.
func (bk *Bank) EventMedia(eventID uint32) []uint32 {
	ev, ok := bk.Objects[eventID]
	if !ok || ev.Type != HircEvent {
		return nil
	}
	var out []uint32
	seen := map[uint32]bool{}
	for _, act := range bk.eventActions(ev.Body) {
		if target, ok := bk.playTarget(act); ok {
			bk.collectMedia(target, seen, &out)
		}
	}
	return out
}

// EventLayers returns the media of an event grouped by what sounds together: every group plays
// at once, one media drawn from each. Each sound action's target is walked down: a lone sound is
// a group of one, a layer container plays all its children (each child its own group or groups),
// and a random sequence or switch container plays one of its media (one group). The run foot
// step is three actions, each a random container (three groups); a weapon shot is one layer
// container of three random containers (three groups). Groups keep hierarchy order; empty ones
// are dropped.
func (bk *Bank) EventLayers(eventID uint32) [][]uint32 {
	ev, ok := bk.Objects[eventID]
	if !ok || ev.Type != HircEvent {
		return nil
	}
	var out [][]uint32
	// The 0x01 actions do not layer: an event that reaches its takes through them names one
	// container per take (slide_outof), so their media make one group, drawn from like a random
	// container.
	var drawn []uint32
	var walk func(id uint32, depth int)
	walk = func(id uint32, depth int) {
		o, ok := bk.object(id)
		if !ok || depth > 16 {
			return
		}
		if o.Type == HircLayer {
			for _, child := range bk.children(o.Body) {
				walk(child, depth+1)
			}
			return
		}
		var group []uint32
		bk.collectMedia(id, map[uint32]bool{}, &group)
		if len(group) > 0 {
			out = append(out, group)
		}
	}
	seen := map[uint32]bool{}
	for _, act := range bk.eventActions(ev.Body) {
		target, ok := bk.playTarget(act)
		if !ok {
			continue
		}
		if a, _ := bk.object(act); byte(binary.LittleEndian.Uint16(a.Body)>>8) != 0x04 {
			bk.collectMedia(target, seen, &drawn)
			continue
		}
		walk(target, 0)
	}
	if len(drawn) > 0 {
		out = append(out, drawn)
	}
	return out
}

// EventTargetTypes returns the HIRC type of each object an event's sound actions target, in
// action order: a caller tells a random container (each media one take, HircRandomSeq) from a
// layer or switch container whose media are not interchangeable.
func (bk *Bank) EventTargetTypes(eventID uint32) []byte {
	ev, ok := bk.Objects[eventID]
	if !ok || ev.Type != HircEvent {
		return nil
	}
	var out []byte
	for _, act := range bk.eventActions(ev.Body) {
		if target, ok := bk.playTarget(act); ok {
			if o, ok := bk.object(target); ok {
				out = append(out, o.Type)
			}
		}
	}
	return out
}

// eventActions reads an event's action list (v135: u8 count, then ids; older banks: u32 count),
// keeping the reading whose every id is an Action of this bank.
func (bk *Bank) eventActions(b []byte) []uint32 {
	for _, form := range [][2]int{{1, 0}, {4, 0}} {
		start := form[0]
		if len(b) < start {
			continue
		}
		n := int(b[0])
		if start == 4 {
			n = int(binary.LittleEndian.Uint32(b))
		}
		if n <= 0 || start+4*n > len(b) {
			continue
		}
		ids := make([]uint32, 0, n)
		for i := 0; i < n; i++ {
			id := binary.LittleEndian.Uint32(b[start+4*i:])
			if o, ok := bk.object(id); !ok || o.Type != HircAction {
				ids = nil
				break
			}
			ids = append(ids, id)
		}
		if ids != nil {
			return ids
		}
	}
	return nil
}

// playTarget returns the object a sound action targets (u16 action type, then u32 target id).
func (bk *Bank) playTarget(actionID uint32) (uint32, bool) {
	act, ok := bk.object(actionID)
	if !ok {
		return 0, false
	}
	if !isSoundAction(act.Body) {
		return 0, false
	}
	id := binary.LittleEndian.Uint32(act.Body[2:])
	_, ok = bk.object(id)
	return id, ok
}

// PlayTargets returns the ids the event's sound actions name, in action order, whether or not
// the target object lives in this bank (an action names a container in a sibling bank the
// runtime loads alongside; the action itself is read here).
func (bk *Bank) PlayTargets(eventID uint32) []uint32 {
	ev, ok := bk.Objects[eventID]
	if !ok || ev.Type != HircEvent {
		return nil
	}
	var out []uint32
	for _, act := range bk.eventActions(ev.Body) {
		a, ok := bk.object(act)
		if !ok || !isSoundAction(a.Body) {
			continue
		}
		out = append(out, binary.LittleEndian.Uint32(a.Body[2:]))
	}
	return out
}

// collectMedia walks down from an object to its sounds. A Sound's source id sits after its
// plugin id (u32) and stream type (u8). A container's children are found as the longest
// {u32 count, ids...} list whose every id is an object of this bank.
func (bk *Bank) collectMedia(id uint32, seen map[uint32]bool, out *[]uint32) {
	if seen[id] {
		return
	}
	seen[id] = true
	o, ok := bk.object(id)
	if !ok {
		return
	}
	if o.Type == HircSound {
		if len(o.Body) >= 9 {
			if src := binary.LittleEndian.Uint32(o.Body[5:]); src != 0 {
				*out = appendUnique(*out, src)
			}
		}
		return
	}
	for _, child := range bk.children(o.Body) {
		bk.collectMedia(child, seen, out)
	}
}

func appendUnique(list []uint32, v uint32) []uint32 {
	for _, x := range list {
		if x == v {
			return list
		}
	}
	return append(list, v)
}

// children finds a container's child list without knowing the version's exact layout.
func (bk *Bank) children(b []byte) []uint32 {
	var best []uint32
	for off := 0; off+4 <= len(b); off++ {
		n := int(binary.LittleEndian.Uint32(b[off:]))
		if n < 1 || n > 512 || n <= len(best) || off+4+4*n > len(b) {
			continue
		}
		ids := make([]uint32, 0, n)
		for i := 0; i < n; i++ {
			id := binary.LittleEndian.Uint32(b[off+4+4*i:])
			if _, ok := bk.object(id); !ok {
				ids = nil
				break
			}
			ids = append(ids, id)
		}
		if ids != nil {
			best = ids
		}
	}
	return best
}

// readHirc reads {count, then count x (type u8, size u32, id u32, body)}.
func (bk *Bank) readHirc(h []byte) error {
	if len(h) < 4 {
		return errors.New("wwise: short HIRC")
	}
	n := int(binary.LittleEndian.Uint32(h))
	off := 4
	for i := 0; i < n; i++ {
		if off+9 > len(h) {
			return fmt.Errorf("wwise: HIRC object %d out of bounds", i)
		}
		typ := h[off]
		size := int(binary.LittleEndian.Uint32(h[off+1:]))
		end := off + 5 + size
		if size < 4 || end > len(h) {
			return fmt.Errorf("wwise: HIRC object %d has a bad size", i)
		}
		id := binary.LittleEndian.Uint32(h[off+5:])
		bk.Objects[id] = HircObject{Type: typ, ID: id, Body: h[off+9 : end]}
		bk.Order = append(bk.Order, id)
		off = end
	}
	return nil
}
