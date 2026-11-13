package main

import (
	"math"
	"regexp"
	"strings"
)

// LevelUp apps/go-api/internal/analysis/modelabel/category.go and mode_label.go.
var contextCategories = map[string]string{"arena": "Assassin", "tactical": "Assassin", "assault": "Assassin", "community": "Assassin", "fiesta": "Fiesta", "castle wars": "Fiesta", "super fiesta": "Super Fiesta", "husky raid": "Husky Raid", "super husky raid": "Husky Raid", "btb": "BTB", "btb heavies": "BTB", "ranked": "Ranked", "firefight": "Firefight", "gruntpocalypse": "Firefight", "event": "Other"}
var contextContainers = []string{"Super Husky Raid", "Super Fiesta", "BTB Heavies", "Castle Wars", "Husky Raid", "Community", "Tactical", "Assault", "Doubles", "Ranked", "Fiesta", "Arena", "Event", "BTB"}
var contextMapSuffix = regexp.MustCompile(`(?i)\s+(?:on|sur)\s+.+$`)
var contextIDSuffix = regexp.MustCompile(`(?i)^(.*?)(?:\s*[\-–—]\s*[0-9A-Za-z]{8,})$`)
var contextModeSuffix = regexp.MustCompile(`(?i)\s*-\s*(?:Forge|Ranked)\b`)

func contextMode(raw string) (string, string) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return "", ""
	}
	base := strings.TrimSpace(contextMapSuffix.ReplaceAllString(raw, ""))
	catbase := base
	if m := contextIDSuffix.FindStringSubmatch(base); m != nil {
		catbase = strings.TrimSpace(m[1])
	}
	left, right, has := strings.Cut(catbase, ":")
	cat, ok := contextCategories[strings.ToLower(strings.TrimSpace(left))]
	if has && !ok {
		cat, ok = contextCategories[strings.ToLower(strings.TrimSpace(right))]
	}
	if !ok {
		cat = "Other"
	}
	if !has {
		return strings.TrimSpace(contextModeSuffix.ReplaceAllString(base, "")), cat
	}
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	for _, identity := range []string{"Super Fiesta", "Husky Raid", "Super Husky Raid"} {
		if strings.EqualFold(left, identity) {
			return identity, cat
		}
	}
	for _, container := range contextContainers {
		if strings.EqualFold(left, container) {
			return strings.TrimSpace(contextModeSuffix.ReplaceAllString(right, "")), cat
		}
	}
	for _, container := range contextContainers {
		if len(right) >= len(container) && strings.EqualFold(right[:len(container)], container) && (len(right) == len(container) || right[len(container)] == ' ') {
			rest := strings.TrimSpace(right[len(container):])
			for _, identity := range []string{"Super Fiesta", "Husky Raid", "Super Husky Raid"} {
				if strings.EqualFold(rest, identity) {
					return identity, cat
				}
			}
			return strings.TrimSpace(contextModeSuffix.ReplaceAllString(strings.TrimSpace(rest+" "+left), "")), cat
		}
	}
	return strings.TrimSpace(contextModeSuffix.ReplaceAllString(right, "")), cat
}

// LevelUp apps/go-api/internal/analysis/scoreboard_extremes.go.
func contextExtremes(rows []contextJSON) {
	humans := []contextJSON{}
	for _, row := range rows {
		if row["is_bot"] != true {
			humans = append(humans, row)
		}
	}
	if len(humans) < 2 {
		return
	}
	best, worst := make([]int, len(humans)), make([]int, len(humans))
	for _, col := range []struct {
		name    string
		weight  int
		inverse bool
	}{{"kills", 2, false}, {"deaths", 2, true}, {"assists", 1, false}, {"kda", 3, false}, {"accuracy", 1, false}, {"score", 3, false}, {"damage_dealt", 2, false}, {"damage_taken", 2, true}, {"headshot_kills", 1, false}, {"max_killing_spree", 1, false}, {"perfect_kills", 1, false}} {
		vals := make([]float64, len(humans))
		min, max := math.Inf(1), math.Inf(-1)
		for i, row := range humans {
			v := math.NaN()
			switch n := row[col.name].(type) {
			case int:
				v = float64(n)
			case float64:
				v = n
			}
			vals[i] = v
			if v < min {
				min = v
			}
			if v > max {
				max = v
			}
		}
		if min >= max {
			continue
		}
		for i, v := range vals {
			if col.inverse {
				if v == min {
					best[i] += col.weight
				}
				if v == max {
					worst[i] += col.weight
				}
			} else {
				if v == max {
					best[i] += col.weight
				}
				if v == min {
					worst[i] += col.weight
				}
			}
		}
	}
	pick := func(count []int, exclude int) int {
		idx, score := -1, 1
		for i, v := range count {
			if i != exclude && v > score {
				idx, score = i, v
			}
		}
		return idx
	}
	lvp := pick(worst, -1)
	mvp := pick(best, -1)
	if lvp == mvp && lvp >= 0 {
		mvp = pick(best, lvp)
	}
	if mvp >= 0 {
		humans[mvp]["is_mvp"] = true
	}
	if lvp >= 0 {
		humans[lvp]["is_lvp"] = true
	}
}
