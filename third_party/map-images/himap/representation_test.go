package himap

import (
	"encoding/binary"
	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"testing"
)

func TestSelectionRepresentation(t *testing.T) {
	a, b := &modeleVariante{}, &modeleVariante{}
	n, absent := int32(123), int32(456)
	reps := map[cleRepresentation]*modeleVariante{{7, n}: b}
	for _, tc := range []struct {
		name  string
		o     mapvar.Object
		want  *modeleVariante
		repli bool
	}{
		{"trouvee", mapvar.Object{TypeID: 7, RepresentationID: &n}, b, false},
		{"autre type", mapvar.Object{TypeID: 8, RepresentationID: &n}, a, true},
		{"inconnue", mapvar.Object{TypeID: 7, RepresentationID: &absent}, a, true},
		{"absente", mapvar.Object{TypeID: 7}, a, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, repli := selectionRepresentation(tc.o, a, reps)
			if got != tc.want || repli != tc.repli {
				t.Fatalf("selection %p repli %v", got, repli)
			}
		})
	}
}

// TestCombleTrous (LOCAL-CHANGE (infinite-theater-3d)): a representation palette's empty slot
// keeps the type's default material at that rank.
func TestCombleTrous(t *testing.T) {
	got := combleTrous([]uint32{0xffffffff, 0x20, 0x30, 0xffffffff}, []uint32{0x1, 0x2, 0x3})
	want := []uint32{0x1, 0x20, 0x30, 0}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("combleTrous = %x, want %x", got, want)
		}
	}
	if combleTrous(nil, []uint32{1}) != nil {
		t.Fatal("nil list filled")
	}
	if len(palettesRepresentations(make([]byte, 16))) != 0 {
		t.Fatal("invalid tag read")
	}
}

func TestRefsRepresentationsInvalides(t *testing.T) {
	tag := make([]byte, 128)
	binary.LittleEndian.PutUint32(tag[0x28:], 128)
	if len(refsRepresentations(tag)) != 0 {
		t.Fatal("tag invalide accepte")
	}
}
