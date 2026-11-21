// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package weaponicons

import "testing"

// TestGroundScaleFromGame — the ground scales measured on the installed game (2026-11-20): every
// weapon 1.3; the pad equipment of AIMBOTZ at their own scales; Active Camo 2, the Drop Wall 1.
func TestGroundScaleFromGame(t *testing.T) {
	r := NewTagReader()
	for id, want := range map[uint32]float64{
		0x0a1992bc: 1.3, 0x6acdc44d: 1.3, 0x2b1824d5: 1.3, // S7 Sniper, Bandit, Sidekick
		0x4396db42: 1.5, 0x7ca85adc: 1.8, 0x430dda48: 2.25, 0x273fe0eb: 2.75, // Shroud, Repulsor, Thruster, Grapple
		0xe7be9f5c: 2, 0x2974c233: 1, // Active Camo, Drop Wall
	} {
		tag, err := r.Tag(id)
		if err != nil {
			t.Skip(err)
		}
		got, err := ReadGroundScale(tag)
		if err != nil {
			t.Fatalf("%08x: %v", id, err)
		}
		if d := got - want; d > 1e-6 || d < -1e-6 {
			t.Errorf("%08x: ground scale %g, want %g", id, got, want)
		}
	}
}
