package weapons

// label_catalog_test.go — the family table's parity with LevelUp's weapon registry: the
// family to key map must equal the map LevelUp's cat.Keys is built from.

import "testing"

// levelUpRegistryFamilies is the family to key projection of LevelUp's
// weaponRegistryInfiniteFilmshell (apps/go-api/internal/games/weapons/registry.go, worktree
// replay-3d, branch integration): one line per family, first id per key, in the registry's
// order. It is the single source the table above is ported from; a drift between the two
// fails here before it reaches a served document.
var levelUpRegistryFamilies = map[string]string{
	"2b1824d5": "hinf_br75",
	"2fb21c87": "hinf_bandit",
	"6acdc44d": "hinf_bandit",
	"48c19d2d": "hinf_ma40_ar",
	"f5c335df": "hinf_ma5k_avenger",
	"fd98554c": "hinf_vk78_commando",
	"0a1992bc": "hinf_s7_sniper",
	"b619d84a": "hinf_cqs48_bulldog",
	"767db96d": "hinf_hydra",
	"71ab0a2c": "hinf_m41_spnkr",
	"9d6aaed2": "hinf_fuel_rod_spnkr",
	"f408190f": "hinf_sidekick",
	"c3542946": "hinf_plasma_pistol",
	"b533957e": "hinf_needler",
	"a0955e9e": "hinf_sentinel_beam",
	"4ff3937e": "hinf_energy_sword",
	"841ac5e5": "hinf_gravity_hammer",
	"0d20c469": "hinf_skewer",
	"230447b1": "hinf_cindershot",
	"2ac9c2ff": "hinf_heatwave",
	"c30d87c7": "hinf_ravager",
	"9387a8b9": "hinf_shock_rifle",
	"1a22fee6": "hinf_shock_rifle",
	"84bd29ed": "hinf_disruptor",
	"80977ba5": "hinf_mangler",
	"d7915565": "hinf_mutilator",
	"30484ea6": "hinf_pulse_carbine",
	"daf193c7": "hinf_stalker_rifle",
	"3e070217": "hinf_vestige_carbine",
	"b6dbead8": "hinf_frag_grenade",
	"c1e1bab0": "hinf_plasma_grenade",
	"3ad55da4": "hinf_dynamo_grenade",
	"00007ca9": "hinf_unarmed",
	"e9e7ff79": "hinf_coil_kinetic",
	"1d63a8cd": "hinf_coil_kinetic",
}

// TestFamilyToKeyMatchesLevelUpRegistry — the embedded family table is the registry's
// projection itself: same entry count, same mapping, and the Bandit Evo family is among
// them (the gap this table was too small for).
func TestFamilyToKeyMatchesLevelUpRegistry(t *testing.T) {
	cat, err := LoadLabelCatalog()
	if err != nil {
		t.Fatal(err)
	}
	if got, want := cat.FamilyToKey["6acdc44d"], "hinf_bandit"; got != want {
		t.Fatalf("6acdc44d: got %q want %q", got, want)
	}
	if got, want := len(cat.FamilyToKey), len(levelUpRegistryFamilies); got != want {
		t.Fatalf("entry count: got %d want %d", got, want)
	}
	for family, key := range levelUpRegistryFamilies {
		if got, ok := cat.FamilyToKey[family]; !ok || got != key {
			t.Fatalf("family %s: got %q want %q", family, got, key)
		}
	}
}

// TestModelKeyForWeaponName — a weapon named by its display name (as a GameCMS theme file
// carries it) resolves to the model key of the weapon that name names: the BR75 to its
// family, and distinct weapons to distinct keys.
func TestModelKeyForWeaponName(t *testing.T) {
	cat, err := LoadLabelCatalog()
	if err != nil {
		t.Fatal(err)
	}
	// The BR75's GameCMS title is "BR75 Battle Rifle"; the table's name is "BR75".
	key, ok := cat.ModelKeyForWeaponName("BR75 Battle Rifle")
	if !ok || key != "2b1824d5" {
		t.Fatalf("BR75 Battle Rifle: got %q %v, want 2b1824d5", key, ok)
	}
	// Distinct weapons give distinct keys.
	br75, _ := cat.ModelKeyForWeaponName("BR75 Battle Rifle")
	ma40, _ := cat.ModelKeyForWeaponName("MA40 Assault Rifle")
	if br75 == ma40 {
		t.Fatalf("BR75 and MA40 resolve to the same key %q", br75)
	}
	// An unknown name does not resolve.
	if _, ok := cat.ModelKeyForWeaponName("NoSuchWeapon"); ok {
		t.Fatalf("NoSuchWeapon: got true, want false")
	}
}
