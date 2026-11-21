// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package weaponicons

import (
	"encoding/binary"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestBanditModelVariantsFromGame pins the measured tag data, without assuming what a
// zero default variant means to the game's customization system.
func TestBanditModelVariantsFromGame(t *testing.T) {
	r := NewTagReader()
	for id, want := range map[uint32]uint32{0x2fb21c87: 0x42c9679f, 0x6acdc44d: 0} {
		tag, err := r.Tag(id)
		if err != nil {
			t.Fatal(err)
		}
		w, err := openWeapTag(tag)
		if err != nil {
			t.Fatal(err)
		}
		root, err := w.rootBlock()
		if err != nil {
			t.Fatal(err)
		}
		abs, size := w.blockAbs(root)
		if abs < 0 || size < 116 || abs+size > len(tag) {
			t.Fatal("invalid weapon root")
		}
		if got := binary.LittleEndian.Uint32(tag[abs+112:]); got != want {
			t.Errorf("%08x default model variant: %08x, want %08x", id, got, want)
		}
	}
	hlmt, err := r.Tag(0xfd84e103)
	if err != nil {
		t.Fatal(err)
	}
	v, ok, err := himap.LitVarianteModele(hlmt, 0x42c9679f)
	if err != nil || !ok {
		t.Fatalf("default variant: found %v, error %v", ok, err)
	}
	if scope, exists := v[0x8b65b2f8]; !exists || scope != 0 {
		t.Errorf("default scope permutation: %08x, present %v", scope, exists)
	}
	mode, err := r.Tag(0xfb41fd43)
	if err != nil {
		t.Fatal(err)
	}
	regions, err := himap.ModeRegions(mode)
	if err != nil {
		t.Fatal(err)
	}
	for _, region := range regions {
		if region.Name == 0x8b65b2f8 {
			if len(region.Permutations) == 0 || region.Permutations[0].Name != 0x3e62c641 {
				t.Fatalf("scope permutations: %+v", region.Permutations)
			}
			return
		}
	}
	t.Fatal("scope region missing")
}
