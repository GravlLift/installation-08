// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/rankicons"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

type contextMedal struct {
	ID   int64 `json:"nameId"`
	Name struct {
		Value string `json:"value"`
	} `json:"name"`
	Description struct {
		Value string `json:"value"`
	} `json:"description"`
	DifficultyIndex int `json:"difficultyIndex"`
}

// contextMedalDifficulty maps the Waypoint difficultyIndex to LevelUp's labels
// (LevelUp apps/go-api/internal/games/halo_infinite/migrations/steps.go).
func contextMedalDifficulty(index int) string {
	switch index {
	case 1:
		return "Heroic"
	case 2:
		return "Legendary"
	case 3:
		return "Mythic"
	}
	return "Normal"
}

func contextReadJSON(path string) map[string]any {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	var v map[string]any
	if json.Unmarshal(raw, &v) != nil {
		return nil
	}
	return v
}
func contextNumber(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, !math.IsNaN(n) && !math.IsInf(n, 0)
	case int:
		return float64(n), true
	case string:
		x, e := strconv.ParseFloat(n, 64)
		return x, e == nil && !math.IsNaN(x) && !math.IsInf(x, 0)
	}
	return 0, false
}

// contextCachedFields is one match's cached context metadata (map-mode pair, playlist and
// map image), read once and shared by the context route and the match list.
type contextCachedFields struct {
	Mode          string
	Category      string
	PlaylistLabel string
	MapImageURL   string
}

func contextCached(root *store.Root, id string, header contextJSON, rows, events []contextJSON) {
	fields := contextCachedFieldsFor(root, id, textValue(header["map_id"]))
	if fields.Mode != "" {
		header["mode_ui"], header["mode_category"] = fields.Mode, fields.Category
	}
	if fields.PlaylistLabel != "" {
		header["playlist_label"] = fields.PlaylistLabel
	}
	if fields.MapImageURL != "" {
		header["map_image_url"] = fields.MapImageURL
	}
	contextSkill(header, rows, contextReadJSON(variantPath(root, id, "skill.json")), rankicons.OutDir(root.Dir()))
	raw, err := os.ReadFile(filepath.Join(root.Dir(), "medals", "metadata.json"))
	if err != nil {
		return
	}
	var cat struct {
		Medals []contextMedal `json:"Medals"`
	}
	if json.Unmarshal(raw, &cat) != nil {
		return
	}
	byID := map[int64]contextMedal{}
	byName := map[string]contextMedal{}
	for _, m := range cat.Medals {
		byID[m.ID] = m
		byName[strings.ToLower(m.Name.Value)] = m
	}
	for _, row := range rows {
		medals, _ := row["medals"].([]contextJSON)
		for _, medal := range medals {
			id, _ := contextNumber(medal["medal_id"])
			if m, ok := byID[int64(id)]; ok {
				medal["label"] = m.Name.Value
				medal["difficulty"] = contextMedalDifficulty(m.DifficultyIndex)
				medal["image_url"] = fmt.Sprintf("/static/medals/halo_infinite/%d.png", m.ID)
			}
		}
		sort.SliceStable(medals, func(i, j int) bool {
			a, _ := contextNumber(medals[i]["count"])
			b, _ := contextNumber(medals[j]["count"])
			return a > b
		})
	}
	for _, event := range events {
		if event["event_type"] != "medal" {
			continue
		}
		if m, ok := byName[strings.ToLower(textValue(event["medal_name"]))]; ok {
			event["medal_name_id"] = m.ID
			event["medal_label"] = m.Name.Value
			event["medal_description"] = m.Description.Value
			event["medal_image_url"] = fmt.Sprintf("/static/medals/halo_infinite/%d.png", m.ID)
		}
	}
}

// contextCachedFieldsFor reads a match's cached context metadata: the map-mode pair's mode
// and category, the playlist label and the stored map image URL ("" when no image file is
// on disk). A file that is absent or unreadable simply leaves its field empty.
func contextCachedFieldsFor(root *store.Root, id, mapID string) contextCachedFields {
	var out contextCachedFields
	pair := contextReadJSON(variantPath(root, id, "map-mode-pair.json"))
	pairName := textValue(pair["PublicName"])
	if pairName == "" {
		pairName = textValue(object(pair["PublicName"])["value"])
	}
	if mode, category := contextMode(pairName); mode != "" {
		out.Mode, out.Category = mode, category
	}
	playlist := contextReadJSON(variantPath(root, id, "playlist.json"))
	if name := textValue(playlist["PublicName"]); name != "" {
		out.PlaylistLabel = contextPlaylistLabel(name)
	} else if name := textValue(object(playlist["PublicName"])["value"]); name != "" {
		out.PlaylistLabel = contextPlaylistLabel(name)
	}
	if mapID != "" && store.ModuleKeyValid(mapID) {
		for _, name := range []string{mapID + ".png", mapID + ".jpg"} {
			if _, err := os.Stat(filepath.Join(root.Dir(), "static", "maps", "halo_infinite", name)); err == nil {
				out.MapImageURL = "/static/maps/halo_infinite/" + name
				break
			}
		}
	}
	return out
}

// contextSkill decorates the scoreboard rows with the per-player CSR rank from the
// cached skill.json. icon_url is set only when the badge file is in the built set: a
// badge the build did not write would 404, and an empty URL is the documented fallback
// (LevelUp emits "" for a badge it does not serve).
func contextSkill(header contextJSON, rows []contextJSON, skill map[string]any, ranksDir string) {
	for _, item := range array(skill["Value"]) {
		entry := object(item)
		if code, ok := contextNumber(entry["ResultCode"]); ok && code != 0 {
			continue
		}
		xuid := strings.TrimSuffix(strings.TrimPrefix(textValue(entry["Id"]), "xuid("), ")")
		result := object(entry["Result"])
		recap := object(result["RankRecap"])
		post := object(recap["PostMatchCsr"])
		initial, _ := contextNumber(post["InitialMeasurementMatches"])
		if initial > 0 {
			header["is_ranked"] = true
		}
		for _, row := range rows {
			if textValue(row["xuid"]) != xuid {
				continue
			}
			stats := object(result["StatPerformances"])
			for _, p := range []struct{ key, expected, std string }{{"Kills", "expected_kills", "kills_stddev"}, {"Deaths", "expected_deaths", "deaths_stddev"}} {
				v := object(stats[p.key])
				if n, ok := contextNumber(v["Expected"]); ok {
					row[p.expected] = n
				}
				if n, ok := contextNumber(v["StdDev"]); ok {
					row[p.std] = n
				}
			}
			if initial > 0 {
				tier := textValue(post["Tier"])
				value, has := contextNumber(post["Value"])
				sub, _ := contextNumber(post["SubTier"])
				if tier != "" && has {
					label := tier
					if sub > 0 {
						roman := []string{"", "I", "II", "III", "IV", "V", "VI"}
						if int(sub) < len(roman) {
							label += " " + roman[int(sub)]
						}
					}
					rank := contextJSON{"rating_type": "CSR", "tier_label": label, "rating_value": value}
					if pre, ok := contextNumber(object(recap["PreMatchCsr"])["Value"]); ok {
						rank["rating_delta"] = value - pre
					}
					name := rankicons.IconName(tier, int(sub))
					if _, err := os.Stat(filepath.Join(ranksDir, name)); err == nil {
						rank["icon_url"] = "/static/ranks/halo_infinite/" + name
					} else {
						rank["icon_url"] = ""
					}
					row["skill_rank"] = rank
				}
			}
		}
	}
}
