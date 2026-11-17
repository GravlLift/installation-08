// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_weapons_doc.go — the weapon fields the server adds when it serves a replay
// document, ported from LevelUp's replay service (GetReplay, apps/go-api/internal/service/
// replay_service.go). LevelUp reads the stored document and then adds, before sending:
//
//   - mapWeaponPads — the map's weapon pad locations crossed with the match's pads
//     (replay_map_weapon_pads.go + libs/film/replay/map_weapon_pads.go),
//   - weaponTiers   — the mode's random-start rule (replay_weapon_tiers.go, regulation.toml),
//   - the per-weapon label enrichment: canonical key, tint, role and impact
//     (replay_weapon_labels.go + libs/film/replay/identity.go),
//   - a cross-check of the pad join (replay_weapon_tier_check.go, analysis/weapontier).
//
// As in LevelUp, none of them is an error: a missing input leaves the field absent,
// the document is still served, and the gap is logged at warn.
//
// The pad locations are derived from the match's own map.mvar (mapvar.PadSpots), the same
// derivation LevelUp freezes into its versioned catalog; the label tables are the title's
// hand-written mappings embedded under internal/weapons/tables.

import (
	"context"
	"encoding/json"
	"log/slog"
	"os"
	"strings"

	"github.com/JGtm/halo-infinite-files-reader/mapvar"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// randomStartModeTokens is the title's rule for which modes draw starting equipment at
// random, ported from LevelUp's config/titles/halo_infinite/mappings/regulation.toml
// ([weapon_tiers], schema 8). The token is searched as a whole word in the mode name.
var randomStartModeTokens = []string{"Castle Wars", "Fiesta", "Husky Raid"}

// matchMapKeys is the map and mode the weapon steps resolve against, read from the match's
// own files (the document names neither).
type matchMapKeys struct {
	mapID    string // match.json mapAssetId
	pairName string // stats.json gameVariantName (the raw mode name)
}

// matchKeysFor reads the map id (match.json) and the mode (stats.json) of a match. An
// absent file leaves the corresponding key empty and the step it feeds degrades to an
// absent field, as in LevelUp; a file that exists but does not parse is an error.
func matchKeysFor(root *store.Root, id string) (matchMapKeys, error) {
	var keys matchMapKeys
	meta, err := os.ReadFile(variantPath(root, id, "match.json"))
	switch {
	case os.IsNotExist(err):
		// no summary: no map id, the pad layer stays absent.
	case err != nil:
		return keys, err
	default:
		var m struct {
			MapAssetID string `json:"mapAssetId"`
		}
		if err = json.Unmarshal(meta, &m); err != nil {
			return keys, err
		}
		keys.mapID = m.MapAssetID
	}
	stats, err := os.ReadFile(variantPath(root, id, "stats.json"))
	switch {
	case os.IsNotExist(err):
		// no stats: no mode name, the tiers stay absent.
	case err != nil:
		return keys, err
	default:
		var s struct {
			GameVariantName string `json:"gameVariantName"`
		}
		if err = json.Unmarshal(stats, &s); err != nil {
			return keys, err
		}
		keys.pairName = s.GameVariantName
	}
	return keys, nil
}

// mapWeaponPadsFor derives the lit pad layer for a match: the map's pad locations
// (its map.mvar) crossed with the match's pads, LevelUp's BuildMapWeaponPads rule.
// A missing or empty input returns nil (the field stays absent).
func mapWeaponPadsFor(ctx context.Context, id string, keys matchMapKeys, variant *mapvar.Variant,
	pads []replay.WeaponPad,
) *replay.MapWeaponPads {
	if keys.mapID == "" || variant == nil || len(pads) == 0 {
		return nil
	}
	spots := mapvar.PadSpots(variant)
	points := mapvar.SpawnPoints(variant)
	if len(spots) == 0 && len(points) == 0 {
		return nil
	}
	out := buildMapWeaponPads(spots, points, pads)
	if out == nil {
		slog.WarnContext(ctx, "map weapon pads: none confirmed although the match has pads",
			"id", id, "map_id", keys.mapID, "map_pads", len(spots), "match_pads", len(pads))
		return nil
	}
	return out
}

// padFamilyEquipment is the family an EQUIPMENT pad publishes: a round floor pad whose item is
// a carried equipment (Repulsor, Threat Sensor, Drop Wall, Translocator...), drawn like a
// weapon pad (the item floats and turns above it).
const padFamilyEquipment = "equipment"

// buildMapWeaponPads crosses the map's pad locations with the match's pads: a location
// leaves only when a match pad confirms it within a metre (the nearest unclaimed one).
// Returns nil when nothing is confirmed, so the document's field stays absent.
// Ported from LevelUp's libs/film/replay BuildMapWeaponPads (map_weapon_pads.go).
//
// EQUIPMENT PADS. The map variant places them two ways, both measured on Live Fire: on the
// powerup pad type (`0x5E86D110`, the Translocator pad) and on the equipment spawn point type
// (`0xE42158DF`, the Repulsor pad, which `PadSpots` does not list). So a match pad whose item is
// an equipment family is published as `equipment` whatever pad type confirmed it, and the
// map's pickup spawn points (`SpawnPoints`, grenade points excepted) confirm the equipment pads
// no pad location claimed. CatalogN still counts the pad locations only.
func buildMapWeaponPads(spots []mapvar.PadSpot, points []mapvar.SpawnPoint, pads []replay.WeaponPad) *replay.MapWeaponPads {
	out := &replay.MapWeaponPads{CatalogN: len(spots)}
	taken := make([]bool, len(pads))
	for _, s := range spots {
		i := confirmBy(s.Pos, pads, taken)
		if i < 0 {
			continue // off: the film never saw it, it does not leave.
		}
		taken[i] = true
		family := string(s.Family)
		if isEquipmentPadItem(pads[i].Weapon) {
			family = padFamilyEquipment
		}
		out.Pads = append(out.Pads, replay.MapWeaponPadDTO{
			X: float32(s.Pos.X), Y: float32(s.Pos.Y), Z: float32(s.Pos.Z),
			Pad: i, Family: family,
			Forward: axisOf(s.Forward), Up: axisOf(s.Up),
		})
	}
	// Only equipment pads may be confirmed by a spawn point: a weapon or power-up pad the pad
	// locations did not confirm keeps its film position, as before.
	for i, p := range pads {
		if !isEquipmentPadItem(p.Weapon) {
			taken[i] = true
		}
	}
	for _, s := range points {
		if s.Kind == mapvar.SpawnKindGrenade {
			continue
		}
		i := confirmBy(s.Pos, pads, taken)
		if i < 0 {
			continue
		}
		taken[i] = true
		out.Pads = append(out.Pads, replay.MapWeaponPadDTO{
			X: float32(s.Pos.X), Y: float32(s.Pos.Y), Z: float32(s.Pos.Z),
			Pad: i, Family: padFamilyEquipment,
		})
	}
	if len(out.Pads) == 0 {
		return nil
	}
	return out
}

// isEquipmentPadItem says whether a match pad's item is a carried equipment: neither a weapon
// family (eight hex digits, `replay.PadWeaponFamilyKey`) nor a power-up (`powerup_*`).
func isEquipmentPadItem(weapon string) bool {
	if weapon == "" || strings.HasPrefix(weapon, "powerup_") {
		return false
	}
	_, isWeapon := replay.PadWeaponFamilyKey(weapon)
	return !isWeapon
}

// axisOf publishes an object axis as [x, y, z], or nil for a zero vector (an object the
// variant gives no orientation), so the field stays absent rather than claiming one.
func axisOf(v mapvar.Vec3) []float32 {
	if v.X == 0 && v.Y == 0 && v.Z == 0 {
		return nil
	}
	return []float32{float32(v.X), float32(v.Y), float32(v.Z)}
}

// confirmBy returns the index of the closest unclaimed match pad within mapWeaponPadMatchM,
// or -1. Ported from LevelUp's confirmePar.
func confirmBy(pos mapvar.Vec3, pads []replay.WeaponPad, taken []bool) int {
	best, bestD := -1, mapWeaponPadMatchM
	for i, p := range pads {
		if taken[i] {
			continue
		}
		d := mapvar.Dist3(pos, mapvar.Vec3{X: float64(p.X), Y: float64(p.Y), Z: float64(p.Z)})
		if d < bestD {
			best, bestD = i, d
		}
	}
	return best
}

// mapWeaponPadMatchM is the confirmation radius in metres: the same threshold as LevelUp's
// measured plan (32 oracle positions on three maps, median 0.01 m).
const mapWeaponPadMatchM = 1.0

// weaponTiersFor resolves the match's weapon tier settings: a single fact, whether the mode
// draws starting equipment at random. Ported from LevelUp's weaponTiersForKeys: nil when the
// match has no known mode (serving randomStarts:false on an unknown mode would assert what
// is actually unknown).
func weaponTiersFor(pairName string) *replay.WeaponTiersInfo {
	if pairName == "" {
		return nil
	}
	return &replay.WeaponTiersInfo{RandomStarts: hasRandomStarts(pairName)}
}

// hasRandomStarts says whether the mode name carries one of the random-start tokens,
// searched as a whole word, case-insensitive — LevelUp's HasRandomStarts rule.
func hasRandomStarts(pairName string) bool {
	name := " " + modeWords.ReplaceAllString(strings.ToLower(strings.TrimSpace(pairName)), " ") + " "
	for _, t := range randomStartModeTokens {
		if strings.Contains(name, " "+strings.ToLower(t)+" ") {
			return true
		}
	}
	return false
}
