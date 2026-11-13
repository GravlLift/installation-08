package main

import (
	"encoding/json"
	"errors"
	"os"
	"strconv"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

type contextKillKey struct {
	killer string
	time   int64
}

func decorateContextKills(root *store.Root, id string, events, rows []contextJSON, t0 int64) error {
	raw, err := os.ReadFile(variantPath(root, id, "kill-details.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var details []build.KillDetail
	if err = json.Unmarshal(raw, &details); err != nil {
		return err
	}
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
		key := contextKillKey{textValue(event["actor_xuid"]), event["event_time_ms"].(int64)}
		detail, ok := byKey[key]
		if !ok || conflicts[key] {
			continue
		}
		if detail.WeaponKey != "" {
			event["weapon_key"] = detail.WeaponKey
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
