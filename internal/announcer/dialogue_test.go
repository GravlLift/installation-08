// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package announcer

import (
	"encoding/binary"
	"reflect"
	"testing"
)

type testDep struct {
	group string
	id    uint32
}

// fourCC stores a group the way tag files do: the u32 whose most significant byte is the first
// letter.
func fourCC(g string) uint32 {
	return uint32(g[0])<<24 | uint32(g[1])<<16 | uint32(g[2])<<8 | uint32(g[3])
}

// testDialogueTag builds a dialogue tag: a root block holding an array of two vocalizations
// (stride 28: name, then a block field at +4), "doublekill" with two sound takes and "triplekill"
// with one, plus a reference to a non-sound tag that must be ignored.
func testDialogueTag() []byte {
	le := binary.LittleEndian
	deps := []testDep{{"snd!", 0xA1}, {"snd!", 0xA2}, {"snd!", 0xB1}, {"sbnk", 0xC1}}
	blocks := [][3]int{{8, 1, 0}, {56, 1, 8}, {32, 1, 64}, {16, 1, 96}} // size, section, offset
	structs := [][3]int{{0, -1, 0}, {1, 0, 0}, {2, 1, 4}, {3, 1, 32}}   // target, field block, field offset
	refs := [][3]int{{2, 0, 0}, {2, 16, 1}, {3, 0, 2}, {0, 4, 3}}       // field block, field offset, dep
	header := tagHeaderFixed + len(deps)*tagDepSize + len(blocks)*tagBlockSize + len(structs)*tagStructSize + len(refs)*tagRefSize
	b := make([]byte, header+112)
	le.PutUint32(b, tagMagic)
	for i, n := range []int{len(deps), len(blocks), len(structs), 0, len(refs)} {
		le.PutUint32(b[tagOffDeps+4*i:], uint32(n))
	}
	le.PutUint32(b[tagOffHeaderLen:], uint32(header))
	o := tagHeaderFixed
	for _, d := range deps {
		le.PutUint32(b[o:], fourCC(d.group))
		le.PutUint32(b[o+0x10:], d.id)
		o += tagDepSize
	}
	for _, bl := range blocks {
		le.PutUint32(b[o:], uint32(bl[0]))
		le.PutUint16(b[o+6:], uint16(bl[1]))
		le.PutUint64(b[o+8:], uint64(bl[2]))
		o += tagBlockSize
	}
	for _, s := range structs {
		le.PutUint32(b[o+20:], uint32(int32(s[0])))
		le.PutUint32(b[o+24:], uint32(int32(s[1])))
		le.PutUint32(b[o+28:], uint32(s[2]))
		o += tagStructSize
	}
	for _, r := range refs {
		le.PutUint32(b[o:], uint32(int32(r[0])))
		le.PutUint32(b[o+4:], uint32(r[1]))
		le.PutUint32(b[o+12:], uint32(int32(r[2])))
		o += tagRefSize
	}
	le.PutUint32(b[header+8:], StringID("doublekill"))
	le.PutUint32(b[header+8+28:], StringID("triplekill"))
	return b
}

func TestVocalizationsReadNamesAndTakes(t *testing.T) {
	tag, err := ParseTag(testDialogueTag())
	if err != nil {
		t.Fatal(err)
	}
	if len(tag.Deps) != 4 || tag.Deps[0].Group != "snd!" || tag.Deps[3].Group != "sbnk" {
		t.Fatalf("deps: %+v", tag.Deps)
	}
	got := Vocalizations(tag)
	want := []Vocalization{
		{Name: StringID("doublekill"), Sounds: []uint32{0xA1, 0xA2}},
		{Name: StringID("triplekill"), Sounds: []uint32{0xB1}},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("vocalizations: %+v, want %+v", got, want)
	}
}

func TestParseTagRefusesOtherFiles(t *testing.T) {
	if _, err := ParseTag([]byte("not a tag file at all, just some bytes padding it out to the header size....")); err == nil {
		t.Fatal("a non-tag parsed")
	}
	raw := testDialogueTag()
	binary.LittleEndian.PutUint32(raw[tagOffDeps:], 1<<20)
	if _, err := ParseTag(raw); err == nil {
		t.Fatal("tables overflowing the file parsed")
	}
}

func TestStringIDIsMurmur3OfTheName(t *testing.T) {
	// Values measured on the game's announcer dialogue tag.
	for name, want := range map[string]uint32{"doublekill": 0xaf70b022, "": 0} {
		if got := StringID(name); got != want {
			t.Fatalf("StringID(%q) = %08x, want %08x", name, got, want)
		}
	}
}

func TestMedalVoiceNames(t *testing.T) {
	cases := map[string][]string{
		"Double Kill":    {"doublekill", "doublekillmedal"},
		"Fire & Forget":  {"fireandforget", "fireandforgetmedal"},
		"Killamanjaro":   {"killimanjaro", "killimanjaromedal"},
		"360":            {"360", "360medal"},
		" - ":            nil,
		"Grim Reaper ":   {"grimreaper", "grimreapermedal"},
		"Mounted&Loaded": {"mountedandloaded", "mountedandloadedmedal"},
	}
	for in, want := range cases {
		if got := MedalVoiceNames(in); !reflect.DeepEqual(got, want) {
			t.Fatalf("MedalVoiceNames(%q) = %v, want %v", in, got, want)
		}
	}
	for _, n := range CallNames([]string{"Double Kill"}) {
		if !ValidName(n) {
			t.Fatalf("call name %q is not a valid file name part", n)
		}
	}
	if ValidName("../x") || ValidName("") || ValidName("Double") {
		t.Fatal("ValidName accepts a name with other characters")
	}
}
