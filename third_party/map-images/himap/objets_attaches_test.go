// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// LOCAL-CHANGE (infinite-theater-3d): ported from The Library with objets_attaches.go.

package himap

import (
	"encoding/binary"
	"errors"
	"math"
	"testing"
)

// synthLien is one struct table entry of a made-up tag: a TagBlock field at offset `champ` of
// block `parent` pointing to block `cible` (-1: no block).
type synthLien struct{ cible, parent, champ int }

// synthTagHimap builds a made-up tag: no dependency, the given data blocks end to end in the tag
// data section, block 0 the root, then the given TagBlock links. No byte of a game tag.
func synthTagHimap(blocs [][]byte, liens ...synthLien) []byte {
	const h = 0x30 // position of the (headerSize, dataSize) pair
	blockTab := h + 0x18
	structTab := blockTab + len(blocs)*blockEntrySize
	header := structTab + (1+len(liens))*structEntrySize
	var data []byte
	tag := make([]byte, header)
	le := binary.LittleEndian
	le.PutUint32(tag[h-0x1c:], uint32(len(blocs)))
	le.PutUint32(tag[h-0x18:], uint32(1+len(liens)))
	for i, b := range blocs {
		e := blockTab + i*blockEntrySize
		le.PutUint32(tag[e:], uint32(len(b)))
		le.PutUint16(tag[e+6:], 1)
		le.PutUint64(tag[e+8:], uint64(len(data)))
		data = append(data, b...)
	}
	le.PutUint32(tag[structTab+0x14:], 0) // the root: struct type 0, block 0
	for i, l := range liens {
		e := structTab + (1+i)*structEntrySize
		le.PutUint16(tag[e+0x10:], 1)
		le.PutUint32(tag[e+0x14:], uint32(int32(l.cible)))
		le.PutUint32(tag[e+0x18:], uint32(int32(l.parent)))
		le.PutUint32(tag[e+0x1c:], uint32(l.champ))
	}
	le.PutUint32(tag[h:], uint32(header))
	le.PutUint32(tag[h+4:], uint32(len(data)))
	return append(tag, data...)
}

// synthMode builds a `mode` whose Sections field points to no block, or, avecSections, to one
// zeroed 60-byte section; it holds one bounding box either way.
func synthMode(avecSections bool) []byte {
	blocs := [][]byte{make([]byte, modeOffBoundingBoxes+24), make([]byte, bboxStride)}
	sections := -1
	if avecSections {
		blocs, sections = append(blocs, make([]byte, sectionStride)), 2
	}
	return synthTagHimap(blocs, synthLien{sections, 0, modeOffSections}, synthLien{1, 0, modeOffBoundingBoxes})
}

// TestModeSansSections: a Sections field with no block is ErrSansSections, never a block read at
// a garbage offset; a Sections block that exists is not.
func TestModeSansSections(t *testing.T) {
	vide := synthMode(false)
	if !modeSansSections(vide) {
		t.Error("a mode whose Sections field has no block reads as having sections")
	}
	if _, err := NewRenderModelAsset(vide, nil); !errors.Is(err, ErrSansSections) {
		t.Errorf("NewRenderModelAsset of an empty mode: %v, want ErrSansSections", err)
	}
	plein := synthMode(true)
	if modeSansSections(plein) {
		t.Error("a mode with one section reads as empty")
	}
	if _, err := NewRenderModelAsset(plein, nil); err != nil {
		t.Errorf("NewRenderModelAsset with one section: %v", err)
	}
}

// synthHlmtAttaches builds a `hlmt` whose single variant attaches three records: `bloc` 0x1111 at
// marker 0x51, a null reference (skipped), and `scen` 0x2222 at marker 0x52 with child marker 0x7.
func synthHlmtAttaches(declares int) []byte {
	root := make([]byte, hlmtOffVariantes+24)
	vars := make([]byte, varianteStride)
	objs := make([]byte, 3*objetAttacheStride)
	le := binary.LittleEndian
	le.PutUint32(root[hlmtOffVariantes+0x10:], 1)
	le.PutUint32(vars[varianteOffObjets+0x10:], uint32(declares))
	put := func(r []byte, parent, enfant, ref uint32, groupe string) {
		le.PutUint32(r[objetAttacheOffParent:], parent)
		le.PutUint32(r[objetAttacheOffEnfant:], enfant)
		le.PutUint32(r[objetAttacheOffRef:], ref)
		copy(r[objetAttacheOffRef+refOffGroupe:], []byte{groupe[3], groupe[2], groupe[1], groupe[0]})
	}
	put(objs, 0x51, 0, 0x1111, "bloc")
	put(objs[objetAttacheStride:], 0x50, 0, 0xffffffff, "bloc")
	put(objs[2*objetAttacheStride:], 0x52, 0x7, 0x2222, "scen")
	return synthTagHimap([][]byte{root, vars, objs},
		synthLien{1, 0, hlmtOffVariantes}, synthLien{2, 1, varianteOffObjets})
}

// TestLisObjetsAttaches: the first variant's records, decoded field by field, the null reference
// left out; a block that is not count x 72 bytes is an error.
func TestLisObjetsAttaches(t *testing.T) {
	got, err := lisObjetsAttaches(synthHlmtAttaches(3))
	if err != nil {
		t.Fatal(err)
	}
	want := []objetAttache{{parent: 0x51, ref: 0x1111, groupe: "bloc"}, {parent: 0x52, enfant: 0x7, ref: 0x2222, groupe: "scen"}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("objects %+v, want %+v", got, want)
	}
	if _, err := lisObjetsAttaches(synthHlmtAttaches(2)); err == nil {
		t.Error("2 records declared on 216 bytes read")
	}
}

// TestPoseAttache: an attachment is posed at its marker instance in the model frame (node x T x
// R), as an Instance whose axes are the rotation's columns; composed with the kit object's pose it
// lands where the two transforms put it. A marker the model does not carry poses nothing.
func TestPoseAttache(t *testing.T) {
	noeuds := []Noeud{{Parent: -1, Quat: [4]float64{0, 0, 0, 1}, Scale: 1}, {Parent: 0, Pos: [3]float64{0, 0, 2}, Quat: [4]float64{0, 0, 0, 1}, Scale: 1}}
	quart := [4]float64{0, 0, math.Sqrt2 / 2, math.Sqrt2 / 2} // 90 degrees about Z
	groupes := []GroupeMarqueurs{{Nom: 0x51, Instances: []InstanceMarqueur{{Region: -1, Permutation: -1, Noeud: 1, Translation: [3]float64{1, 0, 0}, Rotation: quart}}}}
	local, ok := poseAttache(0x51, groupes, noeuds)
	if !ok {
		t.Fatal("marker 0x51 not posed")
	}
	if p := local.LocalToWorld([3]float64{1, 0, 0}); !procheAttache(p, [3]float64{1, 1, 2}) {
		t.Errorf("+X of the attachment at %v in the model, want (1, 1, 2)", p)
	}
	kit := Instance{Scale: [3]float64{1, 1, 1}, Position: [3]float64{10, 0, 0}, Forward: [3]float64{1, 0, 0}, Left: [3]float64{0, 1, 0}, Up: [3]float64{0, 0, 1}}
	if p := composeInstance(kit, local).LocalToWorld([3]float64{1, 0, 0}); !procheAttache(p, [3]float64{11, 1, 2}) {
		t.Errorf("+X of the attachment at %v in the kit's frame, want (11, 1, 2)", p)
	}
	if _, ok := poseAttache(0x53, groupes, noeuds); ok {
		t.Error("a marker the model does not carry posed an attachment")
	}
}

// procheAttache reports whether two points are within 1e-6 of each other on every axis.
func procheAttache(a, b [3]float64) bool {
	for k := range 3 {
		if math.Abs(a[k]-b[k]) > 1e-6 {
			return false
		}
	}
	return true
}
