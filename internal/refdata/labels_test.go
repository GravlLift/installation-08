// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package refdata

import (
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
)

// TestLabelCatalogEmbedded — the embedded label catalog parses, is non-empty, and carries
// the expected tables: weapon names joined to families, grenade labels in rank order,
// ability palettes with markers, shot effects/tints/impacts, equipment families,
// objective objects, flag return zone, and vehicle families. A broken embed would ship
// an anonymous replay to every user, so the catalog is guarded here.
func TestLabelCatalogEmbedded(t *testing.T) {
	cat := Labels()

	// Weapons: at least the acceptance film's weapons must be named.
	if len(cat.Weapons) < 10 {
		t.Fatalf("weapons table too small: %d entries", len(cat.Weapons))
	}
	// The MA40 AR is the film's most common weapon; its family must be named.
	ma40 := cat.Weapons[0x48c19d2d]
	if ma40.Text["en"] != "MA40 AR" {
		t.Fatalf("MA40 AR label = %q, want 'MA40 AR'", ma40.Text["en"])
	}
	if ma40.Fx != "ballistic" {
		t.Fatalf("MA40 AR effect = %q, want 'ballistic'", ma40.Fx)
	}

	// Keys: the family -> weapon_key join must cover the same families.
	if len(cat.Keys) < 10 {
		t.Fatalf("keys table too small: %d entries", len(cat.Keys))
	}
	if cat.Keys[0x48c19d2d] != "hinf_ma40_ar" {
		t.Fatalf("MA40 key = %q, want hinf_ma40_ar", cat.Keys[0x48c19d2d])
	}

	// Grenades: four ranks, in order.
	if len(cat.Grenades) != 4 {
		t.Fatalf("grenades = %d, want 4", len(cat.Grenades))
	}
	if cat.Grenades[0].Text["en"] != "Frag" {
		t.Fatalf("grenade 0 = %q, want 'Frag'", cat.Grenades[0].Text["en"])
	}
	if cat.Grenades[3].Text["en"] != "Spike" {
		t.Fatalf("grenade 3 = %q, want 'Spike'", cat.Grenades[3].Text["en"])
	}

	// Abilities: two palettes with markers.
	if len(cat.Abilities) != 2 {
		t.Fatalf("abilities = %d palettes, want 2", len(cat.Abilities))
	}
	if len(cat.Abilities[0].Markers) == 0 {
		t.Fatal("palette 0 has no markers")
	}
	if len(cat.Abilities[0].Ranks) == 0 {
		t.Fatal("palette 0 has no ranks")
	}

	// Shot effects: the full table is published for kill effects.
	if len(cat.Effects) < 20 {
		t.Fatalf("effects table too small: %d entries", len(cat.Effects))
	}
	if cat.Effects["hinf_ravager"] != "plasma" {
		t.Fatalf("ravager effect = %q, want 'plasma'", cat.Effects["hinf_ravager"])
	}

	// Tints and impacts.
	if len(cat.Tints) < 20 {
		t.Fatalf("tints table too small: %d entries", len(cat.Tints))
	}
	if len(cat.Impacts) == 0 {
		t.Fatal("impacts table is empty")
	}

	// Roles.
	if len(cat.Roles) < 20 {
		t.Fatalf("roles table too small: %d entries", len(cat.Roles))
	}
	if cat.Roles["hinf_s7_sniper"] != "sniper" {
		t.Fatalf("S7 role = %q, want 'sniper'", cat.Roles["hinf_s7_sniper"])
	}

	// Equipment families: 21 GlobalIDs mapped to families.
	if len(cat.EquipmentFamilies) < 20 {
		t.Fatalf("equipment families = %d, want >= 20", len(cat.EquipmentFamilies))
	}
	// Deployed equipment: the two placed Drop Wall objects, never a carried item.
	if !cat.DeployedEquipment[0x528fce46] || !cat.DeployedEquipment[0x686b40c9] ||
		cat.DeployedEquipment[0x7ca85adc] || len(cat.DeployedEquipment) != 2 {
		t.Fatalf("deployed equipment = %v, want the two deployed walls", cat.DeployedEquipment)
	}

	// Objective objects: flag and ball.
	if len(cat.ObjectiveObjects) != 2 {
		t.Fatalf("objective objects = %d, want 2", len(cat.ObjectiveObjects))
	}
	if len(cat.ObjectiveFamilies) != 2 {
		t.Fatalf("objective families = %d, want 2", len(cat.ObjectiveFamilies))
	}
	// The oddball (0x0017592c) must be family "ball".
	if cat.ObjectiveFamilies[0x0017592c] != "ball" {
		t.Fatalf("oddball family = %q, want 'ball'", cat.ObjectiveFamilies[0x0017592c])
	}

	// Flag return zone: declared for Halo Infinite.
	if cat.FlagReturnZone.RadiusM <= 0 {
		t.Fatal("flag return zone radius is zero")
	}

	// Vehicle families: at least the two turrets.
	if len(cat.VehicleFamilies) < 2 {
		t.Fatalf("vehicle families = %d, want >= 2", len(cat.VehicleFamilies))
	}

	// Icons: at least some families have an icon.
	if len(cat.Icons) == 0 {
		t.Fatal("icons table is empty")
	}

	// Ability impulse/charge families.
	if len(cat.AbilityImpulseFamilies) == 0 {
		t.Fatal("ability impulse families is empty")
	}
	if len(cat.AbilityChargeFamilies) == 0 {
		t.Fatal("ability charge families is empty")
	}
}

// TestLabelCatalogNotEmpty — the catalog must not be empty (the Empty method checks
// Weapons, Grenades, Abilities).
func TestLabelCatalogNotEmpty(t *testing.T) {
	cat := Labels()
	if cat.Empty() {
		t.Fatal("label catalog is empty")
	}
}

// TestLabelCatalogGrenadeOrder — grenade labels are in rank order: the index IS the rank.
func TestLabelCatalogGrenadeOrder(t *testing.T) {
	cat := Labels()
	want := []string{"Frag", "Plasma", "Dynamo", "Spike"}
	for i, w := range want {
		if i >= len(cat.Grenades) {
			t.Fatalf("grenades shorter than expected: %d < %d", len(cat.Grenades), len(want))
		}
		if cat.Grenades[i].Text["en"] != w {
			t.Fatalf("grenade %d = %q, want %q", i, cat.Grenades[i].Text["en"], w)
		}
		if got, expected := cat.Grenades[i].Img, "/static/weapons-assets/halo_infinite/hud/"+w+".png"; got != expected {
			t.Errorf("grenade %d image = %q, want %q", i, got, expected)
		}
	}
}

// TestLabelCatalogWeaponLabelType — weapon labels carry the weapon_key and the effect.
func TestLabelCatalogWeaponLabelType(t *testing.T) {
	cat := Labels()
	// The plasma pistol: sidearm role, plasma effect.
	pp := cat.Weapons[0xc3542946]
	if pp.Text["en"] != "Plasma Pistol" {
		t.Fatalf("plasma pistol label = %q", pp.Text["en"])
	}
	if pp.Fx != "plasma" {
		t.Fatalf("plasma pistol effect = %q, want 'plasma'", pp.Fx)
	}
}

// TestLabelCatalogAbilityPaletteFamilies — ability palette ranks carry their family
// when the TOML declares one.
func TestLabelCatalogAbilityPaletteFamilies(t *testing.T) {
	cat := Labels()
	// Palette 0 (famille_a): rank 5 is the thruster.
	p0 := cat.Abilities[0]
	l, ok := p0.Ranks[5]
	if !ok {
		t.Fatal("palette 0 has no rank 5")
	}
	if l.Family != "thruster" {
		t.Fatalf("rank 5 family = %q, want 'thruster'", l.Family)
	}
	if p0.Families[5] != "thruster" {
		t.Fatalf("palette 0 families[5] = %q, want 'thruster'", p0.Families[5])
	}
}

// Ensure replay import is used (it is, via the Labels return type).
var _ = replay.LabelCatalog{}
