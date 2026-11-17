// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package announcer

import (
	"encoding/binary"
	"math/bits"
	"sort"
)

// GroupSound and GroupBank are the tag groups of a sound tag and of a Wwise sound bank tag.
const (
	GroupSound = "snd!"
	GroupBank  = "sbnk"
)

// Vocalization is one line the dialogue tag can say: its name (a string id) and the sound tags
// that say it. Several sound tags are several takes; the game picks one.
type Vocalization struct {
	Name   uint32
	Sounds []uint32
}

// Vocalizations reads a dialogue tag's vocalizations. Each one is an element of an array block
// whose first field is the vocalization's name (a string id) and which owns a block of sound
// references. The element is found from the reference: reference -> its block -> the field that
// points to that block -> the element holding that field (the array's stride is the spacing of
// its elements' block fields).
func Vocalizations(t *Tag) []Vocalization {
	parentOf := map[int]TagStruct{}
	fieldsIn := map[int][]int{}
	for _, s := range t.Structs {
		parentOf[s.Target] = s
		if s.FieldBlock >= 0 {
			fieldsIn[s.FieldBlock] = append(fieldsIn[s.FieldBlock], s.FieldOffset)
		}
	}
	type key struct{ block, element int }
	byElement := map[key]*Vocalization{}
	var order []key
	for _, r := range t.Refs {
		if r.Dep < 0 || r.Dep >= len(t.Deps) || t.Deps[r.Dep].Group != GroupSound {
			continue
		}
		s, ok := parentOf[r.FieldBlock]
		if !ok {
			continue
		}
		stride := elementStride(fieldsIn[s.FieldBlock])
		parent := t.Block(s.FieldBlock)
		if stride <= 0 || parent == nil {
			continue
		}
		start := s.FieldOffset - s.FieldOffset%stride
		if start+4 > len(parent) {
			continue
		}
		k := key{s.FieldBlock, start}
		v, ok := byElement[k]
		if !ok {
			v = &Vocalization{Name: binary.LittleEndian.Uint32(parent[start:])}
			byElement[k] = v
			order = append(order, k)
		}
		v.Sounds = append(v.Sounds, t.Deps[r.Dep].GlobalID)
	}
	out := make([]Vocalization, 0, len(order))
	for _, k := range order {
		out = append(out, *byElement[k])
	}
	return out
}

// elementStride is the smallest spacing between the block fields of an array's elements.
func elementStride(offsets []int) int {
	if len(offsets) < 2 {
		return 0
	}
	s := append([]int(nil), offsets...)
	sort.Ints(s)
	best := 0
	for i := 1; i < len(s); i++ {
		if d := s[i] - s[i-1]; d > 0 && (best == 0 || d < best) {
			best = d
		}
	}
	return best
}

// StringID returns Halo Infinite's string id of a name: MurmurHash3 (x86, 32-bit, seed 0) of its
// bytes. The dialogue tag names its vocalizations with it.
func StringID(name string) uint32 {
	const c1, c2 = 0xcc9e2d51, 0x1b873593
	data := []byte(name)
	h := uint32(0)
	n := len(data) / 4
	for i := 0; i < n; i++ {
		k := binary.LittleEndian.Uint32(data[i*4:])
		k = bits.RotateLeft32(k*c1, 15) * c2
		h ^= k
		h = bits.RotateLeft32(h, 13)*5 + 0xe6546b64
	}
	var k uint32
	tail := data[n*4:]
	for i := len(tail) - 1; i >= 0; i-- {
		k = k<<8 | uint32(tail[i])
	}
	if len(tail) > 0 {
		h ^= bits.RotateLeft32(k*c1, 15) * c2
	}
	h ^= uint32(len(data))
	h ^= h >> 16
	h *= 0x85ebca6b
	h ^= h >> 13
	h *= 0xc2b2ae35
	h ^= h >> 16
	return h
}
