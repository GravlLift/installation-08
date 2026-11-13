package main

import (
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"strconv"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// weaponIconURLPrefix is the route prefix of the weapon icon set the build writes.
const weaponIconURLPrefix = "/static/weapons-assets/halo_infinite/jeu/"

type contextKillKey struct {
	killer string
	time   int64
}

// decorateContextKills stamps the per-kill facts that only the film decode knows
// (weapon, assist, damage shares) onto the kill events built from the death feed.
func decorateContextKills(root *store.Root, id string, events, rows []contextJSON, t0 int64) error {
	var details []build.KillDetail
	if details = readKillDetails(root, id); details == nil {
		// No kill-details file at all. The match was stored before the build learned to
		// write one, or its decode left no publishable kill facts: the events keep their
		// death-feed identity and get no weapon. Rebuilding the match from its film
		// restores the details.
		slog.Info("kill feed details absent, serving kills without weapon", "match_id", id)
		return nil
	}
	// The weapon_key -> icon file map through the built index.json. A set that is not
	// built yet has no index.json: the kills keep their label and get no icon URL, the
	// same fallback as a key the index does not name.
	iconBy, _ := weaponicons.WeaponKeyContourFile(root.Dir())
	byKey := map[contextKillKey]build.KillDetail{}
	conflicts := map[contextKillKey]bool{}
	for _, d := range details {
		key := contextKillKey{d.Killer, int64(d.TimeMS) - t0}
		if _, ok := byKey[key]; ok {
			conflicts[key] = true
		}
		byKey[key] = d
	}
	for _, event := range events {
		if event["event_type"] != "kill" {
			continue
		}
		key := contextKillKey{textValue(event["actor_xuid"]), event["event_time_ms"].(int64)}
		detail, ok := byKey[key]
		if !ok || conflicts[key] {
			continue
		}
		if detail.WeaponKey != "" {
			event["weapon_key"] = detail.WeaponKey
			// The icon is a white mask carried by the alpha (the build drops the RGB),
			// tinted to the killer's team color client-side: always tinted when served.
			if file, ok := iconBy[detail.WeaponKey]; ok {
				event["weapon_image_url"] = weaponIconURLPrefix + file
				event["weapon_image_tinted"] = true
			}
		}
		if detail.WeaponLabel != "" {
			event["weapon_label"] = detail.WeaponLabel
		}
		if detail.AssistState != "" {
			event["assist_state"] = detail.AssistState
		}
		if detail.AssistGamertag != "" {
			event["assist_gamertag"] = detail.AssistGamertag
			for _, row := range rows {
				if strings.EqualFold(textValue(row["gamertag"]), detail.AssistGamertag) {
					if team, e := strconv.Atoi(strings.TrimPrefix(textValue(row["team_side"]), "t")); e == nil {
						event["assist_team_id"] = team
					}
					break
				}
			}
		}
		if detail.KillerDamagePct != nil {
			event["killer_damage_pct"] = *detail.KillerDamagePct
		}
		if detail.AssistDamagePct != nil {
			event["assist_damage_pct"] = *detail.AssistDamagePct
		}
	}
	return nil
}

// readKillDetails reads the variant's kill-details.json. It returns nil (not an error)
// when the file is absent: that is the documented fallback, not a failure.
func readKillDetails(root *store.Root, id string) []build.KillDetail {
	raw, err := os.ReadFile(variantPath(root, id, "kill-details.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		// An unreadable-but-present file would otherwise serve kills with no weapon and
		// no signal that the details were lost: log it before the degradation.
		slog.Warn("kill details unreadable, serving kills without weapon", "match_id", id, "err", err)
		return nil
	}
	var details []build.KillDetail
	if err := json.Unmarshal(raw, &details); err != nil {
		slog.Warn("kill details invalid, serving kills without weapon", "match_id", id, "err", err)
		return nil
	}
	return details
}
