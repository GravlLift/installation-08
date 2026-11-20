// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package weaponicons

import "testing"

// TestShockRifleBarrelShotFromGame — every Shock Rifle variant's barrel fires the shock projectile
// (96555d72, or its parent e9536695 on 9ee5ff15) and plays the firing effect 136580d8.
func TestShockRifleBarrelShotFromGame(t *testing.T) {
	r := NewTagReader()
	for weap, proj := range map[uint32]uint32{0x1a22fee6: 0x96555d72, 0x9387a8b9: 0x96555d72, 0x9ee5ff15: 0xe9536695} {
		tag, err := r.Tag(weap)
		if err != nil {
			t.Skip(err)
		}
		s, err := ReadBarrelShot(tag)
		if err != nil {
			t.Fatalf("%08x: %v", weap, err)
		}
		if s.Projectile != proj || s.FiringEffect != 0x136580d8 {
			t.Errorf("%08x: %+v", weap, s)
		}
	}
}
