// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package wwvorbis

import (
	"bytes"
	"reflect"
	"testing"
)

// Fields of a small stereo setup shared by the stripped and the standard form: one floor 1 with
// one partition of class 0 (1 dimension, no subclass, book 0), multiplier 2, 4 range bits, one
// X value; one residue (begin 0, end 128, partition size 16, one classification, cascade 1, book
// 0); one mapping with one coupling step (magnitude 0, angle 1).
var (
	testFloor1  = []uint32{1, 5, 0, 4, 0, 3, 0, 2, 1, 8, 1, 2, 4, 4, 9, 4}
	testResid   = []uint32{0, 24, 128, 24, 15, 24, 0, 6, 0, 8, 1, 3, 0, 1, 0, 8}
	testMapRest = []uint32{0, 1, 1, 1, 0, 8, 0, 1, 1, 1, 0, 2, 0, 8, 0, 8, 0, 8}
)

func join(parts ...[]uint32) []uint32 {
	var out []uint32
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// strippedSetup is the Wwise form of the test setup: two modes, short then long.
func strippedSetup() []byte {
	return bitsOf(join(
		[]uint32{0, 8, 0, 10}, // one codebook, library id 0
		[]uint32{0, 6}, testFloor1,
		[]uint32{0, 6, 1, 2}, testResid, // residue type 1 on 2 bits
		[]uint32{0, 6}, testMapRest,
		[]uint32{1, 6, 0, 1, 0, 8, 1, 1, 0, 8},
	)...)
}

// standardSetup is the test setup as the Vorbis specification writes it.
func standardSetup() []byte {
	head := []uint32{packetSetup, 8}
	for _, c := range []byte(vorbisMagic) {
		head = append(head, uint32(c), 8)
	}
	return bitsOf(join(
		head, []uint32{0, 8}, testCodebookFull,
		[]uint32{0, 6, 0, 16}, // time domain
		[]uint32{0, 6, 1, 16}, testFloor1,
		[]uint32{0, 6, 1, 16}, testResid,
		[]uint32{0, 6, 0, 16}, testMapRest,
		[]uint32{1, 6, 0, 1, 0, 16, 0, 16, 0, 8, 1, 1, 0, 16, 0, 16, 0, 8},
		[]uint32{1, 1}, // framing
	)...)
}

func TestRewriteSetup(t *testing.T) {
	got, modes, err := rewriteSetup(strippedSetup(), 2, testLibrary(t))
	if err != nil {
		t.Fatal(err)
	}
	if want := standardSetup(); !bytes.Equal(got, want) {
		t.Fatalf("setup\n got % x\nwant % x", got, want)
	}
	if !reflect.DeepEqual(modes, []bool{false, true}) {
		t.Fatalf("modes %v", modes)
	}
}

// TestRewriteSetupRefusesLeftovers — a setup packet longer than its parse means a misread.
func TestRewriteSetupRefusesLeftovers(t *testing.T) {
	if _, _, err := rewriteSetup(append(strippedSetup(), 0), 2, testLibrary(t)); err == nil {
		t.Fatal("a setup packet with a spare byte was accepted")
	}
}

// TestRewriteSetupChecksReferences — a mode naming a mapping that does not exist is refused.
func TestRewriteSetupChecksReferences(t *testing.T) {
	bad := bitsOf(join(
		[]uint32{0, 8, 0, 10},
		[]uint32{0, 6}, testFloor1,
		[]uint32{0, 6, 1, 2}, testResid,
		[]uint32{0, 6}, testMapRest,
		[]uint32{0, 6, 0, 1, 1, 8},
	)...)
	if _, _, err := rewriteSetup(bad, 2, testLibrary(t)); err == nil {
		t.Fatal("a mode with mapping 1 of 1 was accepted")
	}
}
