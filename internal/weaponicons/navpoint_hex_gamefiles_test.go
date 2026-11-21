// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
//go:build gamefiles

package weaponicons

import "testing"

func TestNavpointBadgeFromGame(t *testing.T) {
	r := NewTagReader()
	tag, err := r.Tag(navpointTag)
	if err != nil {
		t.Fatal(err)
	}
	anims, err := r.Tag(navpointAnims)
	if err != nil {
		t.Fatal(err)
	}
	b, err := ReadNavpointBadge(tag, anims)
	if err != nil {
		t.Fatal(err)
	}
	want := func(name string, s NavpointSprite, frame int, size float32) {
		if s.Frame != frame || s.Width != size || s.Height != size {
			t.Errorf("%s: %+v, want frame %d size %v", name, s, frame, size)
		}
	}
	want("fill", b.Fill, 1, 100)
	want("outline", b.Outline, 4, 96)
	want("weapon glyph", b.Glyphs["weapon"], 13, 96)
	want("equipment glyph", b.Glyphs["equipment"], 6, 96)
	want("arrow", b.Arrow, 1, 128)
}
