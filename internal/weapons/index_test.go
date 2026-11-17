// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weapons

import "testing"

// TestWeaponKey — a weapon identifier's model key is its `weap` tag family; falsy for a
// power-up family or any other identifier.
func TestWeaponKey(t *testing.T) {
	cases := map[string][2]any{
		"2b1824d5":           {"2b1824d5", true},
		"0x2b1824d5":         {"2b1824d5", true},
		"0x2b1824d5cafebabe": {"2b1824d5", true},
		"2B1824D5":           {"2b1824d5", true},
		"spartan":            {"", false},
		"0x2b1824d50000":     {"", false}, // bare id longer than 8 with no 0x prefix
	}
	for id, want := range cases {
		got, ok := WeaponKey(id)
		if got != want[0] || ok != want[1] {
			t.Errorf("WeaponKey(%q) = %q, %v, want %v, %v", id, got, ok, want[0], want[1])
		}
	}
}

// TestModelKeyValid — a model key is well-formed when it is a weapon family, a grenade rank,
// or the Spartan.
func TestModelKeyValid(t *testing.T) {
	valid := []string{"2b1824d5", "grenade0", "grenade3", "spartan"}
	for _, k := range valid {
		if !ModelKeyValid(k) {
			t.Errorf("ModelKeyValid(%q) = false, want true", k)
		}
	}
	invalid := []string{"", "spartanx", "grenade", "2b18", "2b1824d5g", "GRENade0"}
	for _, k := range invalid {
		if ModelKeyValid(k) {
			t.Errorf("ModelKeyValid(%q) = true, want false", k)
		}
	}
}
