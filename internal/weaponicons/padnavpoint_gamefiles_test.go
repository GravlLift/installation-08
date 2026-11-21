// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
//go:build gamefiles

package weaponicons

import "testing"

func TestPadNavpointFromGame(t *testing.T) {
	r := NewTagReader()
	tag, err := r.Tag(0x259f5148)
	if err != nil {
		t.Fatal(err)
	}
	got, err := ReadPadNavpoint(tag)
	if err != nil {
		t.Fatal(err)
	}
	if got.IconWidth != 96 || got.IconHeight != 96 || got.IconAlpha != 1 || got.TimerSize != 32 || got.TimerOffsetY != -40 || got.TimerFormat != 1 || got.PowerColor != 0xcb2b3e43 || got.NumericTimerSize != 38 || got.NumericTimerOffsetY != 45 {
		t.Fatalf("unexpected navpoint: %+v", got)
	}
}
