// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// labels.go — the replay label catalog for Halo Infinite, built from the embedded
// reference JSONs (generated from LevelUp's title mappings and weapon registry).
// The catalog is the single source of weapon names, grenade labels, ability palettes,
// shot effects/tints/impacts, equipment families, objective objects, flag return zone,
// vehicle families, and weapon icons for the standalone decode.
package refdata

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strconv"

	"github.com/JGtm/halo-infinite-film-decoder/equipenergy"
	"github.com/JGtm/halo-infinite-film-decoder/replay"
)

//go:embed data/weapon_names.json
var weaponNamesJSON []byte

//go:embed data/equipment_energy.json
var equipmentEnergyJSON []byte

//go:embed data/replay_labels.json
var replayLabelsJSON []byte

//go:embed data/weapon_icons_tags.json
var weaponIconsTagsJSON []byte

// weaponNamesJSON shape: map[weapon_key]struct{En, Fr string}
type weaponNamesTable map[string]struct {
	En string `json:"en"`
	Fr string `json:"fr"`
}

// replayLabelsJSON shape (see gen script and LevelUp replay_labels.toml).
type replayLabelsTable struct {
	Grenades []struct {
		En   string `json:"en"`
		Fr   string `json:"fr"`
		Icon string `json:"icon"`
	} `json:"grenades"`
	Palettes []struct {
		ID      string `json:"id"`
		Markers []int  `json:"markers"`
		Ranks   []struct {
			Rank   int    `json:"rank"`
			En     string `json:"en"`
			Fr     string `json:"fr"`
			Icon   string `json:"icon"`
			Family string `json:"family"`
		} `json:"ranks"`
	} `json:"palettes"`
	ShotEffects      map[string]string `json:"shotEffects"`
	ShotTints        map[string]string `json:"shotTints"`
	ShotImpact       map[string]bool   `json:"shotImpact"`
	EquipmentObjects []struct {
		ID     string `json:"id"`
		Family string `json:"family"`
		Kind   string `json:"kind"`
	} `json:"equipmentObjects"`
	ObjectiveObjects []struct {
		ID     string `json:"id"`
		Family string `json:"family"`
		En     string `json:"en"`
		Fr     string `json:"fr"`
	} `json:"objectiveObjects"`
	FlagReturnZone *struct {
		RadiusM      float64 `json:"radiusM"`
		ResetSeconds float64 `json:"resetSeconds"`
		SoloSeconds  float64 `json:"soloSeconds"`
	} `json:"flagReturnZone"`
	VehicleFamilies []struct {
		Family string `json:"family"`
		En     string `json:"en"`
		Fr     string `json:"fr"`
		Kind   string `json:"kind"`
		Sprite bool   `json:"sprite"`
	} `json:"vehicleFamilies"`
	AbilityImpulseFamilies []string `json:"abilityImpulseFamilies"`
	AbilityChargeFamilies  []string `json:"abilityChargeFamilies"`
}

// weaponIconsTagsJSON shape: map["0x%08x"]string (tag stem)
type weaponIconsTagsTable map[string]string

var (
	weaponNames     = parseWeaponNames()
	replayLabels    = parseReplayLabels()
	weaponIconsTags = parseWeaponIconsTags()
)

func parseWeaponNames() weaponNamesTable {
	var t weaponNamesTable
	if err := json.Unmarshal(weaponNamesJSON, &t); err != nil {
		panic(fmt.Sprintf("embedded weapon_names.json does not parse: %v", err))
	}
	return t
}

func parseReplayLabels() *replayLabelsTable {
	var t replayLabelsTable
	if err := json.Unmarshal(replayLabelsJSON, &t); err != nil {
		panic(fmt.Sprintf("embedded replay_labels.json does not parse: %v", err))
	}
	return &t
}

func parseWeaponIconsTags() weaponIconsTagsTable {
	var t weaponIconsTagsTable
	if err := json.Unmarshal(weaponIconsTagsJSON, &t); err != nil {
		panic(fmt.Sprintf("embedded weapon_icons_tags.json does not parse: %v", err))
	}
	return t
}

// WeaponKeys returns a copy of the weapon family to weapon_key join (familyToKey). A weapon
// family is also the weapon tag's id in the game's module index.
func WeaponKeys() map[uint32]string {
	out := make(map[uint32]string, len(familyToKey))
	for k, v := range familyToKey {
		out[k] = v
	}
	return out
}

// familyToKey is the weapon family (high-32 of the 64-bit weapon id) to weapon_key
// join, extracted from LevelUp's weapon registry (FilmshellWeaponKeysByFamily).
var familyToKey = map[uint32]string{
	0x2b1824d5: "hinf_br75",
	0x2fb21c87: "hinf_bandit",
	0x6acdc44d: "hinf_bandit_evo",
	0x48c19d2d: "hinf_ma40_ar",
	0xf5c335df: "hinf_ma5k_avenger",
	0xfd98554c: "hinf_vk78_commando",
	0x0a1992bc: "hinf_s7_sniper",
	0xb619d84a: "hinf_cqs48_bulldog",
	0x767db96d: "hinf_hydra",
	0x71ab0a2c: "hinf_m41_spnkr",
	0x9d6aaed2: "hinf_fuel_rod_spnkr",
	0xf408190f: "hinf_sidekick",
	0xc3542946: "hinf_plasma_pistol",
	0xb533957e: "hinf_needler",
	0xa0955e9e: "hinf_sentinel_beam",
	0x4ff3937e: "hinf_energy_sword",
	0x841ac5e5: "hinf_gravity_hammer",
	0x0d20c469: "hinf_skewer",
	0x230447b1: "hinf_cindershot",
	0x2ac9c2ff: "hinf_heatwave",
	0xc30d87c7: "hinf_ravager",
	0x9387a8b9: "hinf_shock_rifle",
	0x1a22fee6: "hinf_shock_rifle",
	0x84bd29ed: "hinf_disruptor",
	0x80977ba5: "hinf_mangler",
	0xd7915565: "hinf_mutilator",
	0x30484ea6: "hinf_pulse_carbine",
	0xdaf193c7: "hinf_stalker_rifle",
	0xadb78225: "hinf_stalker_rifle",
	0x3e070217: "hinf_vestige_carbine",
	0xb6dbead8: "hinf_frag_grenade",
	0xc1e1bab0: "hinf_plasma_grenade",
	0x3ad55da4: "hinf_dynamo_grenade",
	0x00007ca9: "hinf_unarmed",
	0xe9e7ff79: "hinf_coil_kinetic",
	0x1d63a8cd: "hinf_coil_kinetic",
}

// rolesByKey is the weapon_key to combat role join, from LevelUp's weapon registry.
var rolesByKey = map[string]string{
	"hinf_br75":            "precision",
	"hinf_bandit":          "precision",
	"hinf_bandit_evo":      "precision",
	"hinf_ma40_ar":         "automatic",
	"hinf_ma5k_avenger":    "automatic",
	"hinf_vk78_commando":   "automatic",
	"hinf_s7_sniper":       "sniper",
	"hinf_cqs48_bulldog":   "shotgun",
	"hinf_hydra":           "power",
	"hinf_m41_spnkr":       "power",
	"hinf_fuel_rod_spnkr":  "power",
	"hinf_sidekick":        "sidearm",
	"hinf_plasma_pistol":   "sidearm",
	"hinf_needler":         "special",
	"hinf_sentinel_beam":   "special",
	"hinf_energy_sword":    "power",
	"hinf_gravity_hammer":  "power",
	"hinf_skewer":          "power",
	"hinf_cindershot":      "power",
	"hinf_heatwave":        "shotgun",
	"hinf_ravager":         "automatic",
	"hinf_shock_rifle":     "sniper",
	"hinf_disruptor":       "sidearm",
	"hinf_mangler":         "sidearm",
	"hinf_mutilator":       "shotgun",
	"hinf_pulse_carbine":   "automatic",
	"hinf_stalker_rifle":   "precision",
	"hinf_vestige_carbine": "precision",
	"hinf_frag_grenade":    "grenade",
	"hinf_plasma_grenade":  "grenade",
	"hinf_dynamo_grenade":  "grenade",
}

// Labels returns the replay label catalog for Halo Infinite, built from the embedded
// reference data. The catalog is process-lifetime: it is immutable and shared.
func Labels() replay.LabelCatalog {
	names := make(map[string]replay.Label, len(weaponNames))
	for key, v := range weaponNames {
		names[key] = replay.Label{Text: replay.Text{"en": v.En, "fr": v.Fr}}
	}

	cat := replay.NewLabelCatalog(familyToKey, names, replayLabels.ShotEffects,
		buildGrenades(), buildAbilities())

	cat.Icons = buildIcons()
	cat.Tints = replayLabels.ShotTints
	cat.Impacts = replayLabels.ShotImpact
	cat.Roles = rolesByKey
	cat.EquipmentFamilies = buildEquipmentFamilies()
	cat.DeployedEquipment = buildDeployedEquipment()
	cat.AbilityImpulseFamilies = replayLabels.AbilityImpulseFamilies
	cat.AbilityChargeFamilies = replayLabels.AbilityChargeFamilies
	cat.ObjectiveObjects, cat.ObjectiveFamilies = buildObjectiveObjects()
	cat.FlagReturnZone = buildFlagReturnZone()
	cat.VehicleFamilies = buildVehicleFamilies()
	return cat
}

func buildGrenades() []replay.Label {
	if len(replayLabels.Grenades) == 0 {
		return nil
	}
	out := make([]replay.Label, 0, len(replayLabels.Grenades))
	for _, g := range replayLabels.Grenades {
		l := replay.Label{Text: replay.Text{"en": g.En, "fr": g.Fr}}
		if g.Icon != "" {
			l.Img = iconURL(g.Icon)
			l.Tinted = true
		}
		out = append(out, l)
	}
	return out
}

func buildAbilities() []replay.AbilityPalette {
	if len(replayLabels.Palettes) == 0 {
		return nil
	}
	out := make([]replay.AbilityPalette, 0, len(replayLabels.Palettes))
	for _, p := range replayLabels.Palettes {
		ranks := make(map[int]replay.Label, len(p.Ranks))
		families := make(map[int]string, len(p.Ranks))
		for _, r := range p.Ranks {
			l := replay.Label{Text: replay.Text{"en": r.En, "fr": r.Fr}}
			if r.Icon != "" {
				l.Img = iconURL(r.Icon)
				l.Tinted = true
			}
			if r.Family != "" {
				l.Family = r.Family
				families[r.Rank] = r.Family
			}
			ranks[r.Rank] = l
		}
		out = append(out, replay.AbilityPalette{
			ID: p.ID, Markers: p.Markers, Ranks: ranks, Families: families,
		})
	}
	return out
}

func buildIcons() map[uint32]replay.WeaponIconRef {
	out := make(map[uint32]replay.WeaponIconRef, len(familyToKey))
	for family, key := range familyToKey {
		if key == "hinf_unarmed" {
			out[family] = replay.WeaponIconRef{URL: "/static/weapons-assets/halo_infinite/jeu/killfeed-65.png", Tinted: true}
			continue
		}
		hex := "0x" + fmt.Sprintf("%08x", family)
		if stem, ok := weaponIconsTags[hex]; ok {
			out[family] = replay.WeaponIconRef{
				URL:    "/static/weapons-assets/halo_infinite/jeu/" + stem + ".png",
				Tinted: true,
			}
			continue
		}
		if index, ok := map[string]string{"hinf_frag_grenade": "46", "hinf_plasma_grenade": "47", "hinf_dynamo_grenade": "48"}[key]; ok {
			out[family] = replay.WeaponIconRef{URL: "/static/weapons-assets/halo_infinite/jeu/killfeed-" + index + ".png", Tinted: true}
		}
		// No icon: the client shows the text label.
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func buildEquipmentFamilies() map[uint32]string {
	if len(replayLabels.EquipmentObjects) == 0 {
		return nil
	}
	out := make(map[uint32]string, len(replayLabels.EquipmentObjects))
	for _, e := range replayLabels.EquipmentObjects {
		if e.ID == "" || e.Family == "" {
			continue
		}
		id, err := strconv.ParseUint(e.ID, 0, 32)
		if err != nil {
			continue
		}
		out[uint32(id)] = e.Family
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// buildDeployedEquipment returns the equipment objects the manifest marks `deployed` (the
// placed form of an item, such as a standing Drop Wall). The pad chain excludes them so a
// placed item is never read as an item waiting on a pad.
func buildDeployedEquipment() map[uint32]bool {
	out := map[uint32]bool{}
	for _, e := range replayLabels.EquipmentObjects {
		if e.Kind != "deployed" {
			continue
		}
		if id, err := strconv.ParseUint(e.ID, 0, 32); err == nil {
			out[uint32(id)] = true
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func buildObjectiveObjects() (map[uint32]replay.Label, map[uint32]string) {
	if len(replayLabels.ObjectiveObjects) == 0 {
		return nil, nil
	}
	labels := make(map[uint32]replay.Label, len(replayLabels.ObjectiveObjects))
	families := make(map[uint32]string, len(replayLabels.ObjectiveObjects))
	for _, o := range replayLabels.ObjectiveObjects {
		if o.ID == "" || o.Family == "" {
			continue
		}
		if o.Family != "flag" && o.Family != "ball" {
			continue
		}
		id, err := strconv.ParseUint(o.ID, 0, 32)
		if err != nil {
			continue
		}
		u := uint32(id)
		labels[u] = replay.Label{Text: replay.Text{"en": o.En, "fr": o.Fr}}
		families[u] = o.Family
	}
	if len(labels) == 0 {
		return nil, nil
	}
	return labels, families
}

func buildFlagReturnZone() replay.FlagReturnZone {
	if replayLabels.FlagReturnZone == nil {
		return replay.FlagReturnZone{}
	}
	return replay.FlagReturnZone{
		RadiusM:      float32(replayLabels.FlagReturnZone.RadiusM),
		ResetSeconds: float32(replayLabels.FlagReturnZone.ResetSeconds),
		SoloSeconds:  float32(replayLabels.FlagReturnZone.SoloSeconds),
	}
}

func buildVehicleFamilies() map[string]replay.VehicleFamilyInfo {
	if len(replayLabels.VehicleFamilies) == 0 {
		return nil
	}
	out := make(map[string]replay.VehicleFamilyInfo, len(replayLabels.VehicleFamilies))
	for _, v := range replayLabels.VehicleFamilies {
		if v.Family == "" {
			continue
		}
		out[v.Family] = replay.VehicleFamilyInfo{
			Label:  replay.Text{"en": v.En, "fr": v.Fr},
			Kind:   v.Kind,
			Sprite: v.Sprite,
		}
	}
	return out
}

// iconURL renders a HUD icon stem (e.g. "hud/Frag") to the static asset URL the
// standalone viewer expects.
func iconURL(stem string) string {
	return "/static/weapons-assets/halo_infinite/" + stem + ".png"
}

// EquipmentEnergy returns the embedded equipment energy catalog, parsed: the per-sofa
// energy costs and thresholds the decoder needs to count remaining uses of carried
// equipment. Generated from the game's eqip tags (LevelUp's cmd/equipenergy-build);
// provenance in NOTICE.md.
func EquipmentEnergy() *equipenergy.Catalog {
	var c equipenergy.Catalog
	if err := json.Unmarshal(equipmentEnergyJSON, &c); err != nil {
		panic(fmt.Sprintf("embedded equipment_energy.json does not parse: %v", err))
	}
	if c.SchemaVersion != equipenergy.SchemaVersion {
		panic(fmt.Sprintf("embedded equipment_energy.json schema %d, want %d", c.SchemaVersion, equipenergy.SchemaVersion))
	}
	return &c
}
