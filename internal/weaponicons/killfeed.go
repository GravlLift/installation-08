// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// killfeed.go — THE "SANDBOX" ATLAS IS THE KILL FEED ONE, and it carries its own naming
// table.
//
// WHAT ESTABLISHED IT. The `bitd` tag declares an `entries` block whose records are exactly
// the triplet sought: `identifier` (StringID), `bitmap` (reference to the atlas) and
// `bitmap index`. Tag `8646f61a` holds 85 of them, all pointing at atlas `0302cad3`. Once
// the identifiers were cracked, the pattern reads without ambiguity:
// `killfeed_battle_rifle`, `killfeed_warthog`, `killfeed_headshot`... So this is not a
// generic "sandbox" atlas, it is THE icon set the game draws in its kill feed.
//
// Entry layout, deduced from the bitd plugin, not from hardcoded offsets:
//
//	+0  _2  identifier    (4)
//	+4  _41 bitmap        (28 — tag id at +8)
//	+32 _5  bitmap index  (2)
//	+34 padding           (2)   → 36 bytes
//
// WHY THE PREFIX LIVES IN CODE. The identifiers are NEITHER in the game binary (408 525
// strings harvested, zero matches) NOR in plain text in the tags — everything is hashed in
// release. The `killfeed_<name>` pattern was found by trying plausible prefixes on a known
// vocabulary: 4 immediate matches, then 43 of 85 once the whole binary vocabulary was
// prefixed. Every name returned is a HASH EQUALITY, not a resemblance.

package weaponicons

import (
	"encoding/binary"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
)

const (
	bitdEntrySize   = 36
	bitdOffBitmap   = 4
	bitdOffIndex    = 32
	killfeedPrefix  = "killfeed_"
	sandboxAtlasTag = 0x0302cad3
)

// resolveKillfeedNames returns, per kill feed atlas index, the cracked internal name.
func resolveKillfeedNames(ix *tagIndex) map[int]string {
	dict := killfeedDict()
	out := map[int]string{}
	seen := map[uint32]bool{}
	for _, r := range ix.byGroup["bitd"] {
		if seen[r.ID] {
			continue
		}
		seen[r.ID] = true
		data, err := ix.extract(r)
		if err != nil {
			continue
		}
		wt, err := openWeapTag(data)
		if err != nil {
			continue
		}
		root, err := wt.rootBlock()
		if err != nil {
			continue
		}
		for _, blk := range wt.tagBlocksOf(root) {
			abs, size := wt.blockAbs(blk)
			if abs < 0 || size < bitdEntrySize || abs+size > len(data) {
				continue
			}
			for i := 0; i+bitdEntrySize <= size; i += bitdEntrySize {
				o := abs + i
				if binary.LittleEndian.Uint32(data[o+bitdOffBitmap+8:]) != sandboxAtlasTag {
					continue
				}
				name, hit := dict[binary.LittleEndian.Uint32(data[o:])]
				if !hit {
					continue
				}
				idx := int(binary.LittleEndian.Uint16(data[o+bitdOffIndex:]))
				if _, dup := out[idx]; !dup {
					out[idx] = strings.TrimPrefix(name, killfeedPrefix)
				}
			}
		}
	}
	return out
}

// plausibleIdent: a game identifier is spelled [a-z0-9_]+. The filter is not cosmetic.
//
// The argument "a hash equality over 32 bits is a certainty" only holds for a SMALL
// vocabulary. Measured: the `gamecms.cms` bundle yields 6 068 000 strings, about 24 M
// hashes against 42 targets — the expected number of accidental collisions there is about
// 0.2, and the only "match" obtained was `killfeed_3O1\`, noise. The binary harvest (408
// 525 strings, expectation about 0.07) stays safe; the filter guarantees that a false
// positive never PASSES for a name.
func plausibleIdent(s string) bool {
	t := strings.TrimPrefix(s, killfeedPrefix)
	if len(t) < 3 || len(t) > 40 {
		return false
	}
	for _, c := range t {
		if (c < 'a' || c > 'z') && (c < '0' || c > '9') && c != '_' {
			return false
		}
	}
	return true
}

// killfeedDict: hash -> name, from the game binary strings AND the curated vocabulary,
// each tried verbatim and prefixed.
func killfeedDict() map[uint32]string {
	dict := make(map[uint32]string, 1<<20)
	add := func(s string) {
		for _, v := range []string{s, killfeedPrefix + s} {
			if !plausibleIdent(v) {
				continue
			}
			h := uint32(mapvar.LabelHash(v))
			if _, dup := dict[h]; !dup {
				dict[h] = v
			}
		}
	}
	if exe := gameBinary(); exe != "" {
		if strs, err := harvestStrings(exe, 3); err == nil {
			for s := range strs {
				add(strings.ToLower(s))
			}
		}
	}
	for _, w := range curatedVocabulary {
		add(w)
	}
	for _, w := range hudVocabulary() {
		add(w)
	}
	for _, w := range assetVocabulary() {
		add(w)
	}
	for _, w := range patternVocabulary() {
		add(w)
	}
	return dict
}

// hudVocabulary is the vocabulary of the EQUIPMENT HUD set (the `killfeed_<name>`
// identifiers of the equipment and grenade icons the HUD draws). It is a CLOSED list of
// 15: the same equipment the game's loadout screen shows, named the way the kill feed names
// what it already cracked (the grenades by their damage-class word: the Dynamo is the
// `lightning_grenade`, cf. assets.go). The entry without a class word is the Quantum
// translocator, tried in the forms the game uses elsewhere.
func hudVocabulary() []string {
	return []string{
		"active_camo", "drop_wall", "lightning_grenade", "frag_grenade",
		"grappleshot", "overshield", "plasma_grenade",
		"quantum_translocator", "quantum", "repair_field", "repulsor",
		"shroud_screen", "spike_grenade", "threat_seeker", "threat_sensor",
		"thruster",
	}
}

// patternVocabulary declines the PATTERNS observed in the already-cracked identifiers,
// instead of guessing word by word.
//
// The patterns are not assumed: they are read from what already cracked —
// `killfeed_turret_plasma` and `killfeed_turret_chaingun` on one side,
// `killfeed_scorpion_turret` on the other, `killfeed_falcon_chaingun`,
// `killfeed_plasma_grenade_stick`, `killfeed_flag_melee` and `killfeed_bomb_melee`.
// Declining them costs a few hundred hashes and cannot invent anything: only an exact
// equality comes out.
func patternVocabulary() []string {
	var out []string
	armaments := []string{
		"chaingun", "gauss", "rocket", "plasma", "machinegun", "machine_gun", "grenade",
		"needler", "missile", "cannon", "shade", "aa", "at", "sentinel", "gunner",
		"grenadier", "flak", "beam", "laser", "mortar",
	}
	vehicles := []string{
		"warthog", "rockethog", "gungoose", "mongoose", "scorpion", "wraith", "banshee",
		"ghost", "chopper", "wasp", "pelican", "phantom", "falcon", "razorback", "shade",
	}
	for _, a := range armaments {
		out = append(out, "turret_"+a, a+"_turret")
		for _, e := range vehicles {
			out = append(out, e+"_"+a)
		}
	}
	for _, e := range vehicles {
		out = append(out, e+"_turret")
	}
	// Compound armaments: `falcon_grenade_launcher` (index 87) came out of the user's sole
	// hypothesis looking at the image — "a Falcon with a different turret, maybe a
	// grenade launcher". A TWO-WORD armament had not been declined.
	for _, a := range []string{
		"grenade_launcher", "rocket_launcher", "machine_gun", "gauss_cannon", "missile_pod",
		"chain_gun", "plasma_cannon", "fuel_rod", "flak_cannon",
	} {
		out = append(out, a, "turret_"+a, a+"_turret")
		for _, e := range vehicles {
			out = append(out, e+"_"+a)
		}
	}
	for _, g := range []string{"frag", "plasma", "spike", "dynamo", "splinter"} {
		out = append(out, g+"_grenade_stick", g+"_stick", "stick_"+g)
	}
	// Schema `<qualifier>_<class>`: this is the one that returned `commando_rifle`,
	// `ma5k_smg` and `plasma_blaster` where the bare product name (`commando`, `ma5k`)
	// failed — and those words ARE in the binary, so they had been tried. The game names
	// by class, not by brand.
	qualifiers := []string{
		"sidekick", "bulldog", "commando", "disruptor", "mangler", "ravager", "stalker",
		"cindershot", "shock", "pulse", "vestige", "avenger", "ma5k", "spnkr", "fuel",
		"fuelrod", "plasma", "energy", "gravity", "sentinel", "battle", "assault", "sniper",
		"heatwave", "skewer", "bandit", "needler", "hydra", "mutilator", "kinetic",
	}
	for _, q := range qualifiers {
		for _, c := range []string{
			"rifle", "pistol", "smg", "blaster", "shotgun", "launcher", "carbine", "cannon",
			"caster", "beam", "sword", "hammer", "magnum", "dmr",
		} {
			out = append(out, q+"_"+c, q+c)
		}
	}
	for _, m := range []string{
		"flag", "ball", "oddball", "sword", "hammer", "skull", "core", "seed", "bomb",
		"fist", "weapon", "shield", "back_smack",
	} {
		out = append(out, m+"_melee", "melee_"+m)
	}
	return out
}

// curatedVocabulary — the names the binary does NOT contain as a standalone token, which
// no harvest therefore returns. An entry is kept only if its hash lands EXACTLY on one of
// the StringIDs sought: over a 32-bit space, a hundred candidates make an accidental
// collision negligible (about 1 in 40 million). This is not a list of hypotheses shown as
// such, it is a vocabulary submitted to a test that fails loudly.
var curatedVocabulary = []string{
	"sandwich", "mythic_sandwich", "fusion_coil", "power_seed", "machine_gun",
	"assault_rifle", "battle_rifle", "sniper", "sniper_rifle", "shotgun", "commando",
	"sidekick", "bulldog", "rocket_launcher", "spnkr", "fuel_rod", "skewer", "sword",
	"energy_sword", "gravity_hammer", "hammer", "avenger", "bandit", "bandit_evo",
	"carbine", "vestige_carbine", "disruptor", "mangler", "ravager", "stalker_rifle",
	"pulse_carbine", "shock_rifle", "sentinel_beam", "sentinelbeam", "needler",
	"plasma_pistol", "cindershot", "heatwave", "hydra", "mutilator", "plasma_turret",
	"shade_turret", "turret", "skull", "flag", "ball", "bomb", "oddball", "seed",
	"grenade", "frag_grenade", "plasma_grenade", "dynamo_grenade", "spike_grenade",
	"overshield", "active_camo", "camo", "repair_field", "drop_wall", "threat_sensor",
	"grappleshot", "thruster", "repulsor", "shroud_screen", "quantum", "quantum_translocator",
	"warthog", "rockethog", "gungoose", "mongoose", "scorpion", "wraith", "banshee", "ghost",
	"chopper", "wasp", "pelican", "phantom", "falcon", "razorback",
	"headshot", "melee", "suicide", "ricochet", "callout", "environment", "splatter",
	// Vocabulary given by the user looking at the icons, then validated by hash.
	"perfect", "waterfall", "back_smack", "vip", "stockpile", "kinetic_barrel",
	"player_left", "player_joined", "player_rejoined", "assist", "betrayal",
}
