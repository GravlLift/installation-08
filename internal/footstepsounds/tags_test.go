package footstepsounds

import (
	"encoding/binary"
	"testing"
)

func TestTheTableListsEverySpartanFootAndMovementSound(t *testing.T) {
	// 15 surfaces x 7 actions minus the two the game has not (grasstall and rock slides).
	if got := len(feetIDs); got != 15 {
		t.Errorf("surfaces %d", got)
	}
	for surface, actions := range feetIDs {
		for action := range actions {
			switch action {
			case walk, run, sprint, shuffle, slide, land, landhard:
			default:
				t.Errorf("%s: unknown action %q", surface, action)
			}
		}
	}
	for surface, actions := range feetIDs {
		for _, action := range []string{walk, run, sprint, shuffle, slide, land, landhard} {
			_, ok := actions[action]
			switch {
			case action == slide && (surface == "grasstall" || surface == "rock"):
				if ok {
					t.Errorf("%s has a %s the game has not", surface, action)
				}
			case !ok:
				t.Errorf("%s is missing %s", surface, action)
			}
		}
	}
	// Four: the slide and slide_outof tags are left out on purpose (tags.go says why).
	if got := len(movementIDs); got != 4 {
		t.Errorf("movement sounds %d", got)
	}
}

func TestTheTagIDsAreUniqueAfterTheByteSwap(t *testing.T) {
	seen := map[uint32]string{}
	for surface, actions := range feetIDs {
		for action, be := range actions {
			id := tagID(be)
			if prev, ok := seen[id]; ok {
				t.Errorf("%s/%s and %s: same id %08x", surface, action, prev, id)
			}
			seen[id] = surface + "/" + action
		}
	}
	for action, be := range movementIDs {
		id := tagID(be)
		if prev, ok := seen[id]; ok {
			t.Errorf("movement/%s and %s: same id %08x", action, prev, id)
		}
	}
}

func TestTagIDSwapsTheBytes(t *testing.T) {
	if got, want := tagID(0x0929E52F), uint32(0x2FE52909); got != want {
		t.Fatalf("tagID = %08x, want %08x", got, want)
	}
	// the swap is its own inverse
	be := make([]byte, 4)
	binary.BigEndian.PutUint32(be, 0x0929E52F)
	if got := tagID(binary.LittleEndian.Uint32(be)); got != 0x0929E52F {
		t.Fatalf("round trip = %08x", got)
	}
}
