// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package weaponicons

import "testing"

// TestShockRifleBarrelShotFromGame — every Shock Rifle variant's barrel fires the shock projectile
// (96555d72, or its parent e9536695 on 9ee5ff15) in bursts (three at 60 rounds a second; five at 30 on 9ee5ff15), and plays the
// firing effect 136580d8.
func TestShockRifleBarrelShotFromGame(t *testing.T) {
	r := NewTagReader()
	type burst struct {
		proj  uint32
		shots int
		rate  float32
	}
	// 9ee5ff15 (its parent projectile) fires five at 30 a second.
	for weap, w := range map[uint32]burst{0x1a22fee6: {0x96555d72, 3, 60}, 0x9387a8b9: {0x96555d72, 3, 60}, 0x9ee5ff15: {0xe9536695, 5, 30}} {
		tag, err := r.Tag(weap)
		if err != nil {
			t.Skip(err)
		}
		s, err := ReadBarrelShot(tag)
		if err != nil {
			t.Fatalf("%08x: %v", weap, err)
		}
		// A burst of fixed size at a fixed rate, one projectile each, no error angle.
		if s.Projectile != w.proj || s.FiringEffect != 0x136580d8 || s.ShotsPerFire != [2]int{w.shots, w.shots} || s.RoundsPerSecond != [2]float32{w.rate, w.rate} ||
			s.FireRecovery != 1 || s.ProjectilesPerShot != 1 || s.ErrorAngle != [2]float32{} {
			t.Errorf("%08x: %+v", weap, s)
		}
	}
}
