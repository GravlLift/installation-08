// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
//go:build gamefiles

package weaponicons

import "testing"

func TestHudColorsFromGame(t *testing.T) {
	r := NewTagReader()
	hud, err := r.Tag(hudColorTable)
	if err != nil {
		t.Fatal(err)
	}
	nav, err := r.Tag(navpointColorTable)
	if err != nil {
		t.Fatal(err)
	}
	c, err := ReadHudColors(hud, nav)
	if err != nil {
		t.Fatal(err)
	}
	want := HudColors{Primary: "#8dc8ff", Warning: "#ffb83f", Critical: "#ff3e3e", Overshield: "#fae58d", Power: "#e2bc52", Waypoint: "#499eea"}
	if c != want {
		t.Errorf("got %+v, want %+v", c, want)
	}
}
