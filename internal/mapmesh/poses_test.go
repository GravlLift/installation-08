// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package mapmesh

import (
	"fmt"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

func pathWords5(words ...string) [himap.NiveauxModes]string {
	var p [himap.NiveauxModes]string
	for i, w := range words {
		if i < himap.NiveauxModes {
			p[i] = w
		}
	}
	return p
}

func TestClassifyPosePath(t *testing.T) {
	cases := []struct {
		path [himap.NiveauxModes]string
		want poseClass
	}{
		{pathWords5("menu", "stance", "set_a", "rare", "stand"), poseStance},
		{pathWords5("menu", "stance", "#abcd1234", "#ef012345", "stand"), poseStance},
		{pathWords5("mp", "intro_emote", "any", "any", "i_see_you"), poseEmote},
		{pathWords5("menu", "customization", "any", "any", "idle"), poseCustomizationIdle},
		{pathWords5("lobby", "player1", "any", "any", "idle"), poseLobbyIdle},
		{pathWords5("lobby", "any", "any", "any", "idle"), poseLobbyIdle},
		{pathWords5("any", "any", "any", "any", "idle"), poseAnyIdle},
		// Not a pose: no stance/emote prefix and not one of the three idles.
		{pathWords5("combat", "rifle", "any", "any", "idle"), poseNone},
		{pathWords5("menu", "any", "any", "any", "idle"), poseNone},
		{pathWords5("lobby", "player1", "any", "any", "walk"), poseNone},
		{pathWords5("mp", "any", "any", "any", "idle"), poseNone},
	}
	for i, c := range cases {
		if got := classifyPosePath(c.path); got != c.want {
			t.Errorf("case %d (%v): classify = %d, want %d", i, c.path, got, c.want)
		}
	}
}

func TestPoseName(t *testing.T) {
	cases := []struct {
		cls  poseClass
		path [himap.NiveauxModes]string
		want string
	}{
		{poseEmote, pathWords5("mp", "intro_emote", "any", "any", "i_see_you"), "i see you"},
		{poseStance, pathWords5("menu", "stance", "set_a", "rare", "stand_up"), "set a rare stand up"},
		{poseCustomizationIdle, pathWords5("menu", "customization", "any", "any", "idle"), "menu customization idle"},
		{poseLobbyIdle, pathWords5("lobby", "player_1", "any", "any", "idle"), "lobby player_1 idle"},
		{poseAnyIdle, pathWords5("any", "any", "any", "any", "idle"), "idle"},
	}
	for i, c := range cases {
		if got := poseName(c.cls, c.path); got != c.want {
			t.Errorf("case %d (%v): name = %q, want %q", i, c.path, got, c.want)
		}
	}
}

func TestPoseWord(t *testing.T) {
	// A hash level that is in poseWords resolves to its word.
	id := himap.NomAnimation("i_see_you_idle")
	if got := poseWord(id); got != "i_see_you_idle" {
		t.Errorf("poseWord(%08x) = %q, want %q", id, got, "i_see_you_idle")
	}
	// A hash level outside the vocabulary keeps the #hash form.
	unknown := himap.NomAnimation("zz_no_such_level_word")
	if got := poseWord(unknown); got != fmt.Sprintf("#%08x", unknown) {
		t.Errorf("poseWord(%08x) = %q, want the #hash form", unknown, got)
	}
	// A word from himap's own vocabulary passes through.
	if got := poseWord(himap.NomAnimation("idle")); got != "idle" {
		t.Errorf("poseWord(idle) = %q, want %q", got, "idle")
	}
}

func TestPoseIDFromPath(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"mp / intro_emote / any / any / i_see_you", "mp:intro_emote:any:any:i_see_you"},
		{"menu / stance / #ABCD1234 / #EF012345 / stand", "menu:stance:abcd1234:ef012345:stand"},
		{"lobby / player1 / any / any / idle", "lobby:player1:any:any:idle"},
	}
	for i, c := range cases {
		if got := poseIDFromPath(c.path); got != c.want {
			t.Errorf("case %d (%q): id = %q, want %q", i, c.path, got, c.want)
		}
	}
}

func TestCollectPosesOrderAndIDs(t *testing.T) {
	candidates := []poseCandidate{
		// The lobby idles, out of name order.
		{key: "aa11:1", path: pathWords5("lobby", "zplayer", "any", "any", "idle"), frames: 40, fps: 30},
		{key: "aa11:2", path: pathWords5("lobby", "aplayer", "any", "any", "idle"), frames: 41, fps: 30},
		// The customization idle, listed twice (same clip, two entries): the first wins.
		{key: "aa11:3", path: pathWords5("menu", "customization", "any", "any", "idle"), frames: 60, fps: 30},
		{key: "aa11:3", path: pathWords5("menu", "customization", "any", "any", "idle"), frames: 60, fps: 30},
		// The any idle, listed twice: the first wins.
		{key: "aa11:4", path: pathWords5("any", "any", "any", "any", "idle"), frames: 30, fps: 30},
		{key: "aa11:4", path: pathWords5("any", "any", "any", "any", "idle"), frames: 30, fps: 30},
		// The stances, out of set order; the last two are distinct clips on the same path
		// (duplicate IDs).
		{key: "aa11:5", path: pathWords5("menu", "stance", "set_b", "rare", "stand_up"), frames: 10, fps: 60},
		{key: "aa11:6", path: pathWords5("menu", "stance", "set_a", "rare", "stand"), frames: 11, fps: 60},
		{key: "aa11:7", path: pathWords5("menu", "stance", "set_a", "rare", "stand"), frames: 12, fps: 60},
		// An unnamed stance on a hash-word set: after the named stances, in clip order.
		{key: "aa11:13", path: pathWords5("menu", "stance", "#00000000", "rare", "zz_standing"), frames: 7, fps: 30},
		// The emotes, out of name order; one on a hash-word path.
		{key: "aa11:8", path: pathWords5("mp", "intro_emote", "any", "any", "z_emote"), frames: 90, fps: 30},
		{key: "aa11:9", path: pathWords5("mp", "intro_emote", "any", "any", "a_emote"), frames: 91, fps: 30},
		{key: "aa11:10", path: pathWords5("mp", "intro_emote", "any", "any", "#abcd1234"), frames: 92, fps: 30},
		// Not a pose: dropped.
		{key: "aa11:11", path: pathWords5("combat", "rifle", "any", "any", "idle"), frames: 5, fps: 30},
		// An idle that is not one of the three: dropped.
		{key: "aa11:12", path: pathWords5("menu", "any", "any", "any", "idle"), frames: 5, fps: 30},
	}
	got := collectPoses(candidates)
	wantIDs := []string{
		"menu:customization:any:any:idle",
		"lobby:aplayer:any:any:idle",
		"lobby:zplayer:any:any:idle",
		"any:any:any:any:idle",
		"menu:stance:set_a:rare:stand",
		"menu:stance:set_a:rare:stand-2",
		"menu:stance:set_b:rare:stand_up",
		"menu:stance:00000000:rare:zz_standing",
		"mp:intro_emote:any:any:a_emote",
		"mp:intro_emote:any:any:z_emote",
		// The unnamed emote comes after the named ones.
		"mp:intro_emote:any:any:abcd1234",
	}
	if len(got) != len(wantIDs) {
		t.Fatalf("got %d poses, want %d: %v", len(got), len(wantIDs), got)
	}
	for i, wantID := range wantIDs {
		if got[i].ID != wantID {
			t.Errorf("pose %d: ID = %q, want %q", i, got[i].ID, wantID)
		}
	}
	kinds := map[string]string{}
	for _, p := range got {
		kinds[p.ID] = p.Kind
	}
	for _, want := range [][2]string{
		{"menu:customization:any:any:idle", PoseKindIdle},
		{"menu:stance:set_a:rare:stand", PoseKindStance},
		{"mp:intro_emote:any:any:a_emote", PoseKindEmote},
	} {
		if kinds[want[0]] != want[1] {
			t.Errorf("pose %s: kind = %q, want %q", want[0], kinds[want[0]], want[1])
		}
	}
	// Frames and FPS pass through the candidate's header.
	if got[1].Frames != 41 || got[1].FPS != 30 {
		t.Errorf("lobby aplayer: frames/fps = %d/%d, want 41/30", got[1].Frames, got[1].FPS)
	}
	if got[4].FPS != 60 {
		t.Errorf("stance stand: fps = %d, want 60", got[4].FPS)
	}
	// Names.
	wantNames := map[string]string{
		"menu:customization:any:any:idle": "menu customization idle",
		"lobby:aplayer:any:any:idle":      "lobby aplayer idle",
		"menu:stance:set_a:rare:stand":    "set a rare stand",
		"mp:intro_emote:any:any:a_emote":  "a emote",
		"mp:intro_emote:any:any:abcd1234": "#abcd1234",
		"any:any:any:any:idle":            "idle",
	}
	for _, p := range got {
		if want, ok := wantNames[p.ID]; ok && p.Name != want {
			t.Errorf("pose %s: name = %q, want %q", p.ID, p.Name, want)
		}
	}
}

func TestCollectPosesFirstClassifyingEntryWins(t *testing.T) {
	// The same clip is reached by a stance entry first and an emote entry after: it is
	// listed once, by the first entry that classifies it.
	got := collectPoses([]poseCandidate{
		{key: "bb22:1", path: pathWords5("menu", "stance", "set_a", "rare", "stand"), frames: 1, fps: 30},
		{key: "bb22:1", path: pathWords5("mp", "intro_emote", "any", "any", "stand"), frames: 2, fps: 30},
	})
	if len(got) != 1 {
		t.Fatalf("got %d poses, want 1: %v", len(got), got)
	}
	if got[0].Kind != PoseKindStance || got[0].ID != "menu:stance:set_a:rare:stand" || got[0].Frames != 1 {
		t.Errorf("first classifying entry lost: %+v", got[0])
	}
}
