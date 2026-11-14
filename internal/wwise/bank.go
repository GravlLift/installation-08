package wwise

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
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

// Bank is a parsed sound bank: its header, its embedded media index and its hierarchy.
type Bank struct {
	Version uint32
	ID      uint32
	// Embedded maps an embedded media id to its bytes inside the DATA chunk.
	Embedded map[uint32][]byte
	Objects  map[uint32]HircObject
	Order    []uint32
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

// actionPlay is the high byte of a Play action's type: only Play actions make a sound heard.
const actionPlay = 0x04

// EventMedia returns the media ids an event plays: Event -> its Play actions -> their target ->
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
			if o, ok := bk.Objects[id]; !ok || o.Type != HircAction {
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

// playTarget returns the object a Play action targets (u16 action type, then u32 target id).
func (bk *Bank) playTarget(actionID uint32) (uint32, bool) {
	b := bk.Objects[actionID].Body
	if len(b) < 6 || byte(binary.LittleEndian.Uint16(b)>>8) != actionPlay {
		return 0, false
	}
	id := binary.LittleEndian.Uint32(b[2:])
	_, ok := bk.Objects[id]
	return id, ok
}

// collectMedia walks down from an object to its sounds. A Sound's source id sits after its
// plugin id (u32) and stream type (u8). A container's children are found as the longest
// {u32 count, ids...} list whose every id is an object of this bank.
func (bk *Bank) collectMedia(id uint32, seen map[uint32]bool, out *[]uint32) {
	if seen[id] {
		return
	}
	seen[id] = true
	o := bk.Objects[id]
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
			if _, ok := bk.Objects[id]; !ok {
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
