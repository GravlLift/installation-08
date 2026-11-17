// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/armor"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// spartansTestStore is a store with one match (human 123, a bot, an
// unidentified player), the player's customization, and the cached
// definitions the manifest reads.
func spartansTestStore(t *testing.T) *store.Root {
	t.Helper()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = root.MatchMeta("abc"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
	if err = root.SaveMatchMeta("abc", store.Match{MatchID: "abc", MapName: "map",
		Players: []store.Player{
			{Name: "Alpha", XUID: "123", TeamID: 0},
			{Name: "Bravo", XUID: "", TeamID: 0, IsBot: true},
			{Name: "Ghost", TeamID: 1},
		}}); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		filepath.Join("matches", "abc", "customization", "123.json"):                                  `{"ArmorCores":{"ArmorCores":[{"CoreId":"core","CorePath":"core.json","IsEquipped":true,"Themes":[{"IsEquipped":true,"ThemePath":"infinite/customization/armor/cores/core/theme.json","HelmetPath":"infinite/customization/armor/items/helmet.json","CoatingPath":"infinite/customization/armor/coatings/steel.json"}]}]},"SpartanBody":{"BodyType":"Medium"},"WeaponCores":{"WeaponCores":[{"CoreId":"core-ar","CorePath":"Cores/Weapon/209-200-olympus-aa30213b.json","CoreType":"WeaponAR","Themes":[{"IsEquipped":true,"ThemePath":"Inventory/Weapon/Themes/t-ar.json","CoatingPath":"Inventory/Weapon/Coatings/wc-ar.json"}]},{"CoreId":"core-br","CorePath":"Cores/Weapon/209-202-olympus-4a7b6c5d.json","CoreType":"WeaponBR","Themes":[{"IsEquipped":true,"ThemePath":"Inventory/Weapon/Themes/t-br.json","CoatingPath":"Inventory/Weapon/Coatings/wc-missing.json"}]}]}}`,
		filepath.Join("gamecms", "infinite", "customization", "armor", "cores", "core", "theme.json"): `{"CommonData":{"Id":"theme","Type":"ArmorTheme"},"TagId":1234,"CoreRegionData":{"BaseRegionData":[{"RegionId":{"m_identifier":1},"PermutationId":{"m_identifier":2}}]}}`,
		filepath.Join("gamecms", "infinite", "customization", "armor", "items", "helmet.json"):        `{"CommonData":{"Id":"helmet","Type":"ArmorHelmet"},"RegionData":[{"RegionId":{"m_identifier":1},"PermutationId":{"m_identifier":9}}]}`,
		filepath.Join("gamecms", "infinite", "customization", "armor", "coatings", "steel.json"):      `{"CommonData":{"Id":"steel","Type":"ArmorCoating"},"StyleId":{"m_identifier":42}}`,
		filepath.Join("gamecms", "inventory", "weapon", "coatings", "wc-ar.json"):                     `{"CommonData":{"Id":"wc","Type":"WeaponCoating"},"StyleId":{"m_identifier":55}}`,
		// The equipped themes name their weapons (the model key resolves from the theme's
		// weapon name, not the core file name).
		filepath.Join("gamecms", "inventory", "weapon", "themes", "t-ar.json"): `{"CommonData":{"Id":"t-ar","Type":"WeaponTheme","Title":{"status":"Ready","value":"MA40 Assault Rifle"}},"ParentPaths":[{"Path":"Cores/Weapon/209-200-olympus-aa30213b.json","Type":"WeaponCore"}]}`,
		filepath.Join("gamecms", "inventory", "weapon", "themes", "t-br.json"): `{"CommonData":{"Id":"t-br","Type":"WeaponTheme","Title":{"status":"Ready","value":"BR75 Battle Rifle"}},"ParentPaths":[{"Path":"Cores/Weapon/209-202-olympus-4a7b6c5d.json","Type":"WeaponCore"}]}`,
	}
	for p, body := range files {
		if err = root.WriteFile(filepath.Join(root.Dir(), filepath.FromSlash(p)), []byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	return root
}

// TestMatchSpartansServed — GET /api/matches/{id}/spartans serves the roster
// with the equipped player's manifest and per-player fallbacks.
func TestMatchSpartansServed(t *testing.T) {
	h := newTestHandlers(spartansTestStore(t), nil)
	rec := get(t, h, "/api/matches/abc/spartans", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var got armor.Spartans
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.MatchID != "abc" || len(got.Players) != 3 {
		t.Fatalf("spartans: %+v", got)
	}
	human, bot, ghost := got.Players[0], got.Players[1], got.Players[2]
	if human.Status != armor.StatusArmor || human.XUID != "123" || human.Manifest == nil || human.FetchedAt == nil {
		t.Fatalf("human: %+v", human)
	}
	m := human.Manifest
	if m.CoreID != "core" || m.ThemeTagID != 1234 || len(m.ConfigHash) != 32 ||
		len(m.Regions) != 1 || m.Regions[0].RegionKey != "00000001" ||
		m.Regions[0].PermutationKey != "00000009" || m.Regions[0].Source != "helmet" ||
		len(m.Unresolved) != 0 {
		t.Fatalf("manifest: %+v", m)
	}
	if m.Coating == nil || m.Coating.StyleID == nil || *m.Coating.StyleID != 42 || m.Coating.StyleKey != "0000002a" {
		t.Fatalf("coating: %+v", m.Coating)
	}
	// The equipped weapon cores: the model key is the weapon the equipped theme names
	// (not the core file's shared suffix); one reads its coating style from the cache, the
	// other's coating file is absent (model key kept, no style: neutral paint).
	if len(human.WeaponCoatings) != 2 {
		t.Fatalf("weapon coatings: %+v", human.WeaponCoatings)
	}
	ar, br := human.WeaponCoatings[0], human.WeaponCoatings[1]
	// MA40 Assault Rifle -> hinf_ma40_ar -> family 48c19d2d.
	if ar.ModelKey != "48c19d2d" || ar.StyleKey != "00000037" {
		t.Fatalf("ar weapon coating: %+v", ar)
	}
	// BR75 Battle Rifle -> hinf_br75 -> family 2b1824d5; its coating file is absent.
	if br.ModelKey != "2b1824d5" || br.StyleKey != "" {
		t.Fatalf("br weapon coating: %+v", br)
	}
	if bot.Status != armor.StatusDefault || bot.Reason != armor.ReasonBot {
		t.Fatalf("bot: %+v", bot)
	}
	if ghost.Status != armor.StatusDefault || ghost.Reason != armor.ReasonUnknownPlayer {
		t.Fatalf("ghost: %+v", ghost)
	}
}

// TestMatchSpartansFallbacks — a player whose customization or theme is
// missing gets their reason; the rest of the response is served.
func TestMatchSpartansFallbacks(t *testing.T) {
	root := spartansTestStore(t)
	h := newTestHandlers(root, nil)
	// No cached theme: the equipped player falls back to api_error.
	if err := root.WriteFile(filepath.Join(root.Dir(), "gamecms", "infinite", "customization", "armor", "cores", "core", "theme.json"), []byte(`{"CommonData":{"Id":"theme"}}`)); err != nil {
		t.Fatal(err)
	}
	rec := get(t, h, "/api/matches/abc/spartans", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var got armor.Spartans
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Players[0].Status != armor.StatusDefault || got.Players[0].Reason != armor.ReasonAPIError {
		t.Fatalf("human: %+v", got.Players[0])
	}
	// A customization without equipped armor: no_armor.
	if err := root.WriteFile(filepath.Join(root.MatchesDir(), "abc", "customization", "456.json"), []byte(`{"ArmorCores":{"ArmorCores":[]},"SpartanBody":{}}`)); err != nil {
		t.Fatal(err)
	}
	meta, err := root.MatchMeta("abc")
	if err != nil {
		t.Fatal(err)
	}
	meta.Players = append(meta.Players, store.Player{Name: "Delta", XUID: "456", TeamID: 1})
	if err = root.SaveMatchMeta("abc", meta); err != nil {
		t.Fatal(err)
	}
	rec = get(t, h, "/api/matches/abc/spartans", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if err = json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Players[3].Status != armor.StatusDefault || got.Players[3].Reason != armor.ReasonNoArmor {
		t.Fatalf("delta: %+v", got.Players[3])
	}
}

// TestMatchSpartansUnknownMatch — a match that is not in the store is 404.
func TestMatchSpartansUnknownMatch(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	h := newTestHandlers(root, nil)
	rec := get(t, h, "/api/matches/abc/spartans", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "match_not_found") {
		t.Fatalf("body: %s", rec.Body.String())
	}
}

// TestMatchSpartansInvalidID — an id the store does not accept is 400.
func TestMatchSpartansInvalidID(t *testing.T) {
	h := newTestHandlers(spartansTestStore(t), nil)
	rec := get(t, h, "/api/matches/not%20valid/spartans", nil)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}
