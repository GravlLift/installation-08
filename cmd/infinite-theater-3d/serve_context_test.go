package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/build"
)

func TestContextRoute(t *testing.T) {
	for _, full := range []bool{false, true} {
		t.Run(map[bool]string{false: "reduced", true: "full"}[full], func(t *testing.T) {
			root := newFakeStore(t)
			names := []string{"stats.json"}
			if full {
				names = append(names, "stats-full.json")
			}
			for _, name := range names {
				data, err := os.ReadFile(filepath.Join("testdata", "context", name))
				if err != nil {
					t.Fatal(err)
				}
				if err = root.WriteFile(variantPath(root, "abc", name), data); err != nil {
					t.Fatal(err)
				}
			}
			rec := get(t, newTestHandlers(root, nil), "/api/matches/abc/context?xuid=1", nil)
			if rec.Code != http.StatusOK {
				t.Fatalf("%d %s", rec.Code, rec.Body.String())
			}
			var got struct {
				Header     map[string]any   `json:"header"`
				Scoreboard []map[string]any `json:"scoreboard"`
				Media      struct {
					Items []any `json:"media_items"`
				} `json:"media"`
			}
			if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
				t.Fatal(err)
			}
			if len(got.Scoreboard) != 2 || got.Scoreboard[0]["is_me"] != true || got.Scoreboard[0]["kills"] != float64(5) || got.Media.Items == nil {
				t.Fatalf("unexpected context: %s", rec.Body.String())
			}
			if full && (got.Header["t0_ms"] != float64(20000) || got.Header["playable_duration_seconds"] != float64(580) || got.Scoreboard[0]["damage_dealt"] != float64(1234)) {
				t.Fatalf("missing full stats: %s", rec.Body.String())
			}
		})
	}
	rec := get(t, newTestHandlers(newFakeStore(t), nil), "/api/matches/fff0000/context", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing match: %d %s", rec.Code, rec.Body.String())
	}
}

func TestContextScoreRounds(t *testing.T) {
	stats := build.Stats{GameVariantName: "Ranked:Oddball", TeamScores: &[2]int{200, 185}, Players: []build.StatsPlayer{{XUID: "1", TeamID: 1}}}
	payload := map[string]any{"Teams": []any{map[string]any{"TeamId": float64(0), "Stats": map[string]any{"CoreStats": map[string]any{"RoundsWon": float64(1), "RoundsLost": float64(2)}}}, map[string]any{"TeamId": float64(1), "Stats": map[string]any{"CoreStats": map[string]any{"RoundsWon": float64(2), "RoundsLost": float64(1)}}}}}
	header := contextJSON{}
	contextScore(header, stats, payload, "1")
	if header["score_label"] != "2 - 1" || header["score_points_label"] != "185 - 200" || header["score_kind"] != "rounds" {
		t.Fatalf("score: %v", header)
	}
}

func TestContextWithoutStats(t *testing.T) {
	rec := get(t, newTestHandlers(newFakeStore(t), nil), "/api/matches/abc/context", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("missing stats: %d %s", rec.Code, rec.Body.String())
	}
}

func TestContextObjective(t *testing.T) {
	row := contextJSON{}
	fillContextObjective(row, map[string]any{"OddballStats": map[string]any{"SkullGrabs": float64(2), "TimeAsSkullCarrier": "PT1M2.5S"}, "VipStats": map[string]any{"TimesSelectedAsVip": float64(3)}})
	objective, _ := row["objective"].(contextJSON)
	if objective["skull_grabs"] != float64(2) || objective["time_as_skull_carrier_seconds"] != 62.5 || objective["times_selected_as_vip"] != float64(3) {
		t.Fatalf("objective: %v", objective)
	}
}

func TestContextKillDetails(t *testing.T) {
	root := newFakeStore(t)
	path, _ := root.MatchReplayPath("abc")
	if err := root.WriteFile(path, gzipJSON(t, []byte(`{"killCauses":[{"feedMs":30000,"killer":"1","victim":"2"}]}`))); err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile(variantPath(root, "abc", "kill-details.json"), []byte(`[{"time_ms":30000,"killer":"1","assist_state":"named","assist_gamertag":"Helper","killer_damage_pct":75,"weapon_key":"br75"}]`)); err != nil {
		t.Fatal(err)
	}
	result, err := buildContext(root, "abc", "")
	if err != nil {
		t.Fatal(err)
	}
	events := result["highlight_events"].([]contextJSON)
	if len(events) != 1 || events[0]["assist_gamertag"] != "Helper" || events[0]["killer_damage_pct"] != 75 || events[0]["weapon_key"] != "br75" {
		t.Fatalf("events: %v", events)
	}
}

func TestContextDerivedScoreboard(t *testing.T) {
	root := newFakeStore(t)
	raw := []byte(`{"MatchInfo":{},"Players":[{"PlayerId":"xuid(1)","Gamertag":"Alpha","LastTeamId":0,"ParticipationInfo":{"FirstJoinedTime":"2026-01-01T00:00:20.926Z"},"PlayerTeamStats":[{"Stats":{"CoreStats":{"Kills":2,"Deaths":1,"Assists":3,"DamageDealt":900,"DamageTaken":450,"AverageLifeDuration":"PT29.8S","Medals":[{"NameId":1512363953,"Count":2}]}}}]}]}`)
	if err := root.WriteFile(variantPath(root, "abc", "stats-full.json"), raw); err != nil {
		t.Fatal(err)
	}
	rec := get(t, newTestHandlers(root, nil), "/api/matches/abc/context?xuid=1", nil)
	var got struct {
		Scoreboard []map[string]any `json:"scoreboard"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Scoreboard) == 0 {
		t.Fatalf("response: %s", rec.Body.String())
	}
	row := got.Scoreboard[0]
	for key, want := range map[string]any{"avg_life_seconds": float64(29), "first_joined_time": "2026-01-01T00:00:20Z", "perfect_kills": float64(2), "offensive_conversion": 0.75, "defensive_resistance": float64(2), "damage_per_kill": float64(450), "damage_per_death": float64(450)} {
		if row[key] != want {
			t.Errorf("%s = %v, want %v", key, row[key], want)
		}
	}
}
