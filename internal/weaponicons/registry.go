// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// registry.go — the weapon families: the high 32 bits of a filmshell weapon id mapped to
// a family key.
//
// The keys are the `arme` VALUES OF THE LEVELUP BUILDER's index.json, kept verbatim so
// the same install produces the same index: the standalone had no reason to invent new
// names where the source already had stable ones. The mapping id -> key is fixed (the
// registry's order is the order of the table below); several ids per family (Ranked,
// skins) resolve to the same family, the first id seen wins, exactly as LevelUp's
// `weaponRegistryInfiniteFilmshell` does.
//
// The families without an atlas icon are the grenades (they are not `weap` tags) and the
// two product objects (unarmed, fusion coil): they appear in the key table but never in
// the icon entries.

package weaponicons

import "sort"

type weaponFamily struct {
	Key string
	ID  uint32
}

// weaponFamilyTable: the installed game's filmshell weapon ids, first id seen per family.
var weaponFamilyTable = []weaponFamily{
	{"hinf_br75", 0x2b1824d5},            // BR75
	{"hinf_bandit", 0x2fb21c87},          // Bandit
	{"hinf_bandit_evo", 0x6acdc44d},      // Bandit Evo
	{"hinf_ma40_ar", 0x48c19d2d},         // MA40
	{"hinf_ma5k_avenger", 0xf5c335df},    // MA5K Avenger
	{"hinf_vk78_commando", 0xfd98554c},   // VK78 Commando
	{"hinf_s7_sniper", 0x0a1992bc},       // S7
	{"hinf_cqs48_bulldog", 0xb619d84a},   // CQS43 Bulldog
	{"hinf_hydra", 0x767db96d},           // Hydra
	{"hinf_m41_spnkr", 0x71ab0a2c},       // M41 SPNKr
	{"hinf_fuel_rod_spnkr", 0x9d6aaed2},  // Fuel Rod SPNKr
	{"hinf_sidekick", 0xf408190f},        // Sidekick
	{"hinf_plasma_pistol", 0xc3542946},   // Plasma Pistol
	{"hinf_needler", 0xb533957e},         // Needler
	{"hinf_sentinel_beam", 0xa0955e9e},   // Sentinel Beam
	{"hinf_energy_sword", 0x4ff3937e},    // Energy Sword (Duelist: 0x4ff3937e, tag 8978aa7a; Infected: tag 1ec48c7a)
	{"hinf_gravity_hammer", 0x841ac5e5},  // Gravity Hammer (Diminisher: a730e49f; Rushdown: d8d07ca1)
	{"hinf_skewer", 0x0d20c469},          // Skewer
	{"hinf_cindershot", 0x230447b1},      // Cindershot
	{"hinf_heatwave", 0x2ac9c2ff},        // Heatwave
	{"hinf_ravager", 0xc30d87c7},         // Ravager
	{"hinf_shock_rifle", 0x9387a8b9},     // Shock Rifle (Ranked: 0x1a22fee6)
	{"hinf_disruptor", 0x84bd29ed},       // Disruptor
	{"hinf_mangler", 0x80977ba5},         // Mangler
	{"hinf_mutilator", 0xd7915565},       // Mutilator
	{"hinf_pulse_carbine", 0x30484ea6},   // Pulse Carbine
	{"hinf_stalker_rifle", 0xdaf193c7},   // Stalker Rifle (second family: 0xadb78225)
	{"hinf_vestige_carbine", 0x3e070217}, // Vestige Carbine
	{"hinf_frag_grenade", 0xb6dbead8},    // Frag Grenade (not a `weap` tag)
	{"hinf_plasma_grenade", 0xc1e1bab0},  // Plasma Grenade (not a `weap` tag)
	{"hinf_dynamo_grenade", 0x3ad55da4},  // Dynamo Grenade (not a `weap` tag)
	{"hinf_unarmed", 0x00007ca9},         // Unarmed (no atlas icon)
	{"hinf_coil_kinetic", 0xe9e7ff79},    // Fusion Coil (forge: 0x1d63a8cd)
}

// weaponFamilies returns the families sorted by key.
func weaponFamilies() []weaponFamily {
	out := make([]weaponFamily, len(weaponFamilyTable))
	copy(out, weaponFamilyTable)
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	return out
}
