package build

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
	"github.com/JGtm/halo-infinite-film-decoder/types"
)

func TestKillDetails(t *testing.T) {
	result := &decfilm.Result{BijectionDetermined: true, Kills: []decfilm.Kill{{TimeMS: 30000, Feed: decfilm.FeedTruth{Killer: "Alpha"}, Assist: decfilm.Assist{Known: true, Name: "Helper"}, KillerDamage: decfilm.DamageShare{Known: true, Pct: 75}}}}
	details := killDetails(result, []types.Death{{XUID: 1, Gamertag: "Alpha"}})
	if len(details) != 1 || details[0].Killer != "1" || details[0].AssistState != "named" || details[0].AssistGamertag != "Helper" || details[0].KillerDamagePct == nil || *details[0].KillerDamagePct != 75 {
		t.Fatalf("details: %+v", details)
	}
	result.BijectionDetermined = false
	if got := killDetails(result, nil); got != nil {
		t.Fatalf("unpublishable details: %+v", got)
	}
}

// TestKillDetailsKillfeedSprite pins the kill feed sprite of each kind of damage source
// measured on stored matches (2026-11-15): melee has no weapon key but a sprite, a fall
// (DEGAT_GLOBAL) gets the environment sprite, a collision gets splatter, a registry
// weapon gets both its key and its sprite, and an unknown tag gets nothing.
func TestKillDetailsKillfeedSprite(t *testing.T) {
	kill := func(tag uint32, category decfilm.Category) decfilm.Kill {
		k := decfilm.Kill{TimeMS: 1000, Feed: decfilm.FeedTruth{Killer: "Alpha"}}
		k.Source.Tag = tag
		k.Source.Category = category
		if tag == 0x00403594 {
			k.Source.Class = "DEGAT_GLOBAL"
		}
		return k
	}
	cases := []struct {
		name   string
		k      decfilm.Kill
		sprite string
		key    string
	}{
		{"melee (shared weme effect)", kill(0x2ff92041, decfilm.CategoryNone), "killfeed-65", ""},
		{"melee (shared weap effect)", kill(0xdaa03c35, decfilm.CategoryNone), "killfeed-65", ""},
		{"fall / environment", kill(0x00403594, decfilm.CategoryNone), "killfeed-55", ""},
		{"splatter (collision category)", kill(0x0000005f, decfilm.CategoryCollisionDamage), "killfeed-60", ""},
		{"registry weapon", kill(0x0be508f9, decfilm.CategoryNone), "killfeed-00", "hinf_br75"},
		{"unknown tag", kill(0, decfilm.CategoryNone), "", ""},
	}
	for _, tc := range cases {
		result := &decfilm.Result{BijectionDetermined: true, Kills: []decfilm.Kill{tc.k}}
		details := killDetails(result, []types.Death{{XUID: 1, Gamertag: "Alpha"}})
		if len(details) != 1 {
			t.Fatalf("%s: details %+v", tc.name, details)
		}
		if details[0].KillfeedSprite != tc.sprite || details[0].WeaponKey != tc.key {
			t.Errorf("%s: sprite %q key %q, want %q %q", tc.name, details[0].KillfeedSprite, details[0].WeaponKey, tc.sprite, tc.key)
		}
	}
}
