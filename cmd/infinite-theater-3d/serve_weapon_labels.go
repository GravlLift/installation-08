// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_weapon_labels.go — the per-weapon label enrichment the server adds when it serves a
// replay document, ported from LevelUp's replay service (resolveWeaponLabels,
// replay_weapon_labels.go): complete the labels the document lacks, then give every label
// the canonical key, the shot render family, the discharge tint, the combat role and the
// impact flag of its key. Plus the pad-join cross-check (checkWeaponTierJoin,
// replay_weapon_tier_check.go + analysis/weapontier), which warns when the join appears
// shifted. Neither step is ever an error: a missing table or an unclassified weapon leaves
// the field empty, the document is still served.

import (
	"context"
	"fmt"
	"log/slog"
	"strings"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// weaponFamilyHex renders a weapon family the way the film writes it (8 lowercase hex
// digits): the table's key and the document's label keys share this spelling.
func weaponFamilyHex(fam uint32) string {
	return fmt.Sprintf("%08x", fam)
}

// enrichWeaponLabels is the label step: complete the document's labels from the catalog,
// then join each label to the tables of its key. Stored text and fx are retained except for
// the old mixed-language Bandit label, which is corrected from the game's strings.
//
// Ported from LevelUp's resolveWeaponLabels; the catalog is the embedded table set instead
// of the title's config directory (same content, one title).
func enrichWeaponLabels(ctx context.Context, cat weaponsCatalog, doc *replay.ReplayDocument) {
	if len(doc.WeaponLabels) == 0 &&
		len(doc.Loadouts) == 0 && len(doc.Shots) == 0 && len(doc.WeaponPads) == 0 {
		return
	}
	if n := replay.CompleteWeaponLabels(doc, cat.LabelCatalog); n > 0 {
		slog.InfoContext(ctx, "replay document: weapons named at request (artefact cooked before the registry knew them)",
			"added", n)
	}
	labelPickedWeapons(doc, cat.LabelCatalog)
	for id, lbl := range doc.WeaponLabels {
		family, ok := replay.FamilyOfWeaponID(id)
		if !ok {
			continue
		}
		key, ok := cat.FamilyToKey[weaponFamilyHex(family)]
		if !ok {
			// Out-of-registry weapon: it keeps its label, stays mute and untinted.
			// Borrowing a neighbour's key would give it another weapon's voice.
			continue
		}
		// Older artifacts used one mixed-language label for both Bandits.
		if (family == 0x2fb21c87 || family == 0x6acdc44d) && lbl.Text["en"] == "M392 Bandit" && lbl.Text["fr"] == "Bandit EVO" {
			if corrected, ok := cat.LabelCatalog.Weapons[family]; ok {
				lbl.Text = corrected.Text.Clone()
			}
		}
		if icon, ok := cat.LabelCatalog.Icons[family]; ok && (lbl.Img == "" ||
			lbl.Img == "/static/weapons-assets/halo_infinite/Grenade.png" ||
			lbl.Img == "/static/weapons-assets/halo_infinite/Melee.png") {
			lbl.Img, lbl.Tinted = icon.URL, icon.Tinted
		}
		lbl.Key = key
		lbl.Tint = cat.ShotTints[key]
		lbl.Role = cat.Roles[key]
		lbl.Impact = cat.ShotImpacts[key]
		doc.WeaponLabels[id] = lbl
	}
}

// labelPickedWeapons names the weapons the document only knows from a pickup or swap
// (`weaponChanges[].w`, a bare 8-hex family). The completion pass (replay.CompleteWeaponLabels)
// names loadout, shot and pad ids only, so a weapon a player picked up and held without it ever
// appearing in a loadout row kept no label under the id the client looks up for the hand
// (`0x` + the upper-case family): the viewer showed it unpainted, with no ammo counter. On
// Streets (ee234787) that was the Stalker Rifle 0xadb78225, held for most of a life. Only adds.
func labelPickedWeapons(doc *replay.ReplayDocument, cat replay.LabelCatalog) {
	for _, c := range doc.WeaponChanges {
		if c.W == "" {
			continue
		}
		id := "0x" + strings.ToUpper(strings.TrimPrefix(c.W, "0x"))
		if _, ok := doc.WeaponLabels[id]; ok {
			continue
		}
		family, ok := replay.FamilyOfWeaponID(id)
		if !ok {
			continue
		}
		lbl, ok := cat.Weapons[family]
		if !ok {
			continue
		}
		if ic, ok := cat.Icons[family]; ok {
			lbl.Img, lbl.Tinted = ic.URL, ic.Tinted
		}
		if doc.WeaponLabels == nil {
			doc.WeaponLabels = map[string]replay.WeaponLabel{}
		}
		doc.WeaponLabels[id] = lbl
	}
}

// weaponsCatalog is the server's weapon label tables for the served document, loaded once
// at startup from the embedded mappings.
type weaponsCatalog = weapons.LabelCatalog

// checkWeaponTierJoin is the guardrail of the pad join: it warns when power-family
// locations carry weapons whose role is a light one — the signature of a shifted join.
// Silent in the nominal case, as in LevelUp: a log line per match is a log no one reads.
// Ported from LevelUp's checkWeaponTierJoin + weapontier.RunCrossCheck.
func checkWeaponTierJoin(ctx context.Context, id string, cat weaponsCatalog, doc *replay.ReplayDocument) {
	if doc.MapWeaponPads == nil || len(doc.WeaponPads) == 0 {
		return
	}
	roleOf := func(weapon string) string {
		lbl, ok := doc.WeaponLabels[weapon]
		if !ok {
			return ""
		}
		return cat.Roles[lbl.Key]
	}
	familyByPad := make([]string, len(doc.WeaponPads))
	for _, s := range doc.MapWeaponPads.Pads {
		if s.Pad >= 0 && s.Pad < len(familyByPad) {
			familyByPad[s.Pad] = s.Family
		}
	}
	c := runTierCrossCheck(doc.WeaponPads, familyByPad, roleOf)
	if !tierCrossCheckAlert(c) {
		return
	}
	slog.WarnContext(ctx, "replay document: light-role weapons on power pads, the location x pad join may be shifted",
		"id", id, "pads", c.Pads, "inversions", c.LightOnPower,
		"share", float64(c.LightOnPower)/float64(c.Pads), "threshold", tierCrossCheckAlertShare,
		"weapons", c.Weapons)
}

// tierCrossCheck is the cross-check result: how many pads carry a weapon whose role
// contradicts their location.
type tierCrossCheck struct {
	Pads         int
	LightOnPower int
	Weapons      map[string]int
}

// tierCrossCheckAlertShare is the share of pads above which the join is held suspect:
// LevelUp's measured threshold (one inversion already alerts a match of 50 pads or fewer,
// and no match in the fleet publishes 50 pads).
const tierCrossCheckAlertShare = 0.02

// tierCrossCheckLightRoles — the roles that do not belong on a power pad, written here
// rather than guessed: `shotgun` is deliberately ABSENT (thirteen power pads in the fleet
// carry one; that is the power shotgun, not an error).
var tierCrossCheckLightRoles = map[string]bool{"automatic": true, "sidearm": true, "precision": true}

// tierCrossCheckPower is the location family the check looks at: power, and power only.
const tierCrossCheckPower = "power"

// runTierCrossCheck counts the pads whose location family is power and whose weapon's role
// is a light one. Ported from LevelUp's weapontier.RunCrossCheck (same direction, same set).
func runTierCrossCheck(pads []replay.WeaponPad, familyByPad []string, roleOf func(weapon string) string) tierCrossCheck {
	out := tierCrossCheck{Pads: len(pads), Weapons: map[string]int{}}
	for i, p := range pads {
		if familyByPad[i] != tierCrossCheckPower {
			continue
		}
		if tierCrossCheckLightRoles[roleOf(p.Weapon)] {
			out.LightOnPower++
			out.Weapons[p.Weapon]++
		}
	}
	return out
}

// tierCrossCheckAlert says whether the cross-check crossed its threshold.
// Ported from LevelUp's CrossCheck.Alert.
func tierCrossCheckAlert(c tierCrossCheck) bool {
	return c.Pads > 0 && c.LightOnPower > 0 &&
		float64(c.LightOnPower) >= float64(c.Pads)*tierCrossCheckAlertShare
}
