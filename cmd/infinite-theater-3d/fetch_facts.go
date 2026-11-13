package main

import (
	"encoding/json"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/build"
)

type matchPayload struct {
	Info struct {
		Map struct {
			ID      string `json:"AssetId"`
			Version string `json:"VersionId"`
		} `json:"MapVariant"`
		Mode struct {
			Name string `json:"PublicName"`
		} `json:"UgcGameVariant"`
	} `json:"MatchInfo"`
	Players []struct {
		ID         string `json:"PlayerId"`
		Name       string `json:"Gamertag"`
		LastTeamID int    `json:"LastTeamId"`
		Teams      []struct {
			ID    int `json:"TeamId"`
			Stats struct {
				Core struct{ Kills, Deaths, Assists int } `json:"CoreStats"`
			} `json:"Stats"`
		} `json:"PlayerTeamStats"`
	} `json:"Players"`
	Teams []struct {
		ID    int `json:"TeamId"`
		Stats struct {
			Core struct {
				Score int `json:"Score"`
			} `json:"CoreStats"`
		} `json:"Stats"`
	} `json:"Teams"`
}

func matchFacts(raw []byte) (build.Stats, string, string, error) {
	var p matchPayload
	if err := json.Unmarshal(raw, &p); err != nil {
		return build.Stats{}, "", "", err
	}
	f := build.Stats{GameVariantName: p.Info.Mode.Name}
	for _, player := range p.Players {
		var t struct {
			ID    int `json:"TeamId"`
			Stats struct {
				Core struct{ Kills, Deaths, Assists int } `json:"CoreStats"`
			} `json:"Stats"`
		}
		if len(player.Teams) > 0 {
			t = player.Teams[0]
		}
		id := strings.TrimSuffix(strings.TrimPrefix(player.ID, "xuid("), ")")
		f.Players = append(f.Players, build.StatsPlayer{Name: player.Name, XUID: id, TeamID: player.LastTeamID, Kills: t.Stats.Core.Kills, Deaths: t.Stats.Core.Deaths, Assists: t.Stats.Core.Assists})
	}
	var scores [2]int
	var found [2]bool
	for _, team := range p.Teams {
		if team.ID >= 0 && team.ID < 2 {
			scores[team.ID] = team.Stats.Core.Score
			found[team.ID] = true
		}
	}
	if found[0] && found[1] {
		f.TeamScores = &scores
	}
	return f, p.Info.Map.ID, p.Info.Map.Version, nil
}
