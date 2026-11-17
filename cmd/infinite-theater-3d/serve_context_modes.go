// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
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
