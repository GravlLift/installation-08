package main

import (
	"fmt"

	"github.com/llampwall/infinite-theater-3d/internal/build"
)

// contextRoundsDecide mirrors LevelUp's regulation.toml [rounds_decide]: the variants whose
// result is read in rounds, not points (LevelUp internal/analysis/team_score_display.go).
func contextRoundsDecide(variant string) bool {
	switch variant {
	case "Arena:Oddball", "Ranked:Oddball", "Oddball:Arena":
		return true
	}
	return false
}

func contextScore(header contextJSON, stats build.Stats, payload map[string]any, xuid string) {
	reverse := false
	for _, p := range stats.Players {
		if xuid != "" && p.XUID == xuid && p.TeamID == 1 {
			reverse = true
			break
		}
	}
	var points *[2]int
	if stats.TeamScores != nil && stats.TeamScores[0] >= 0 && stats.TeamScores[1] >= 0 {
		pair := *stats.TeamScores
		if reverse {
			pair[0], pair[1] = pair[1], pair[0]
		}
		points = &pair
	}
	var rounds [2]int
	var found [2]bool
	total := 0
	for _, v := range array(payload["Teams"]) {
		team := object(v)
		id, ok := team["TeamId"].(float64)
		if !ok || (id != 0 && id != 1) {
			continue
		}
		core := object(object(team["Stats"])["CoreStats"])
		if core == nil {
			continue
		}
		won, _ := core["RoundsWon"].(float64)
		lost, _ := core["RoundsLost"].(float64)
		tied, _ := core["RoundsTied"].(float64)
		rounds[int(id)] = int(won)
		found[int(id)] = true
		if n := int(won + lost + tied); n > total {
			total = n
		}
	}
	// Rounds reading: the per-team won counts from the stats file (fresh) or the raw payload
	// (the fallback for a match whose stats file predates the rounds field). The total plays
	// LevelUp's RoundsTotal: the reading needs a match that actually had rounds to read.
	if contextRoundsDecide(stats.GameVariantName) {
		if stats.TeamRoundsWon != nil && found[0] && found[1] {
			rounds[0], rounds[1] = (*stats.TeamRoundsWon)[0][0], (*stats.TeamRoundsWon)[1][0]
		}
		if total >= 2 && found[0] && found[1] && rounds[0] >= 0 && rounds[1] >= 0 {
			if reverse {
				rounds[0], rounds[1] = rounds[1], rounds[0]
			}
			header["score_mine"], header["score_theirs"], header["score_kind"], header["score_label"] = rounds[0], rounds[1], "rounds", fmt.Sprintf("%d - %d", rounds[0], rounds[1])
			if points != nil {
				header["score_points_label"] = fmt.Sprintf("%d - %d", points[0], points[1])
			}
			return
		}
	}
	if points != nil {
		header["score_mine"], header["score_theirs"], header["score_kind"], header["score_label"] = points[0], points[1], "points", fmt.Sprintf("%d - %d", points[0], points[1])
	}
}
