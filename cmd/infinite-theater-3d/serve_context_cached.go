package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/store"
)

type contextMedal struct {
	ID   int64 `json:"NameId"`
	Name struct {
		Value string `json:"value"`
	} `json:"Name"`
	Description struct {
		Value string `json:"value"`
	} `json:"Description"`
	Difficulty string `json:"Difficulty"`
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
		return n, true
	case string:
		x, e := strconv.ParseFloat(n, 64)
		return x, e == nil
	}
	return 0, false
}
func contextCached(root *store.Root, id string, header contextJSON, rows, events []contextJSON) {
	pair := contextReadJSON(variantPath(root, id, "map-mode-pair.json"))
	pairName := textValue(pair["PublicName"])
	if pairName == "" {
		pairName = textValue(object(pair["PublicName"])["value"])
	}
	if mode, category := contextMode(pairName); mode != "" {
		header["mode_ui"], header["mode_category"] = mode, category
	}
	playlist := contextReadJSON(variantPath(root, id, "playlist.json"))
	if name := textValue(playlist["PublicName"]); name != "" {
		header["playlist_label"] = name
	} else if name := textValue(object(playlist["PublicName"])["value"]); name != "" {
		header["playlist_label"] = name
	}
	mapID := textValue(header["map_id"])
	if mapID != "" && store.ModuleKeyValid(mapID) {
		name := mapID + ".png"
		if _, err := os.Stat(filepath.Join(root.Dir(), "static", "maps", "halo_infinite", name)); err == nil {
			header["map_image_url"] = "/static/maps/halo_infinite/" + name
		}
	}
	contextSkill(header, rows, contextReadJSON(variantPath(root, id, "skill.json")))
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
				medal["difficulty"] = m.Difficulty
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
func contextSkill(header contextJSON, rows []contextJSON, skill map[string]any) {
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
					icon := tier + strconv.Itoa(int(sub))
					if tier == "Onyx" || sub <= 0 {
						icon = "Onyx"
					}
					rank["icon_url"] = "/static/ranks/halo_infinite/120px-HINF-CSR_" + icon + ".png"
					row["skill_rank"] = rank
				}
			}
		}
	}
}
