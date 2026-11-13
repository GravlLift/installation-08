package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
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

// TestContextScoreRoundsFresh pins the fresh reading: the stats file carries the per-team
// RoundsWon (the builder now records it from the payload Teams), and the score is read in
// those rounds, not in the cumulative points (which would crown the wrong team).
func TestContextScoreRoundsFresh(t *testing.T) {
	rounds := [2][3]int{{3, 0, 0}, {1, 0, 0}}
	stats := build.Stats{GameVariantName: "Ranked:Oddball", TeamScores: &[2]int{150, 240}, TeamRoundsWon: &rounds, Players: []build.StatsPlayer{{XUID: "1", TeamID: 0}}}
	payload := map[string]any{"Teams": []any{map[string]any{"TeamId": float64(0), "Stats": map[string]any{"CoreStats": map[string]any{"RoundsWon": float64(0)}}}, map[string]any{"TeamId": float64(1), "Stats": map[string]any{"CoreStats": map[string]any{"RoundsWon": float64(4)}}}}}
	header := contextJSON{}
	contextScore(header, stats, payload, "1")
	if header["score_kind"] != "rounds" || header["score_label"] != "3 - 1" || header["score_points_label"] != "150 - 240" {
		t.Fatalf("fresh rounds must beat the stale payload and the cumulative points: %v", header)
	}
}

// TestContextScoreRoundsTotalGuard pins the LevelUp RoundsTotal guard: a variant whose
// teams never had rounds to read (total < 2) falls back to the points, never inventing
// a 0 - 0 round reading.
func TestContextScoreRoundsTotalGuard(t *testing.T) {
	rounds := [2][3]int{{1, 0, 0}, {0, 0, 0}}
	stats := build.Stats{GameVariantName: "Ranked:Oddball", TeamScores: &[2]int{90, 120}, TeamRoundsWon: &rounds, Players: []build.StatsPlayer{{XUID: "1", TeamID: 0}}}
	payload := map[string]any{"Teams": []any{map[string]any{"TeamId": float64(0), "Stats": map[string]any{"CoreStats": map[string]any{"RoundsWon": float64(0)}}}, map[string]any{"TeamId": float64(1), "Stats": map[string]any{"CoreStats": map[string]any{"RoundsWon": float64(0)}}}}}
	header := contextJSON{}
	contextScore(header, stats, payload, "1")
	if header["score_kind"] != "points" || header["score_label"] != "90 - 120" {
		t.Fatalf("no rounds played: the points must stand: %v", header)
	}
}

// TestContextOutcome pins the header outcome for the viewing player: xuid narrows to that
// player's own line (LevelUp serves the caller's result), empty xuid means "any
// participant" so a plain viewer still gets a result, and the colors/tokens are LevelUp's.
func TestContextOutcome(t *testing.T) {
	payload := map[string]any{"Players": []any{
		map[string]any{"PlayerId": "xuid(2)", "Outcome": float64(3)},
		map[string]any{"PlayerId": "xuid(1)", "Outcome": float64(2)},
	}}
	for _, tc := range []struct {
		xuid  string
		want  string
		token string
		color string
	}{
		{"1", "win", "outcome-win", "#22c55e"},
		{"2", "loss", "outcome-loss", "#ef4444"},
		{"", "loss", "outcome-loss", "#ef4444"},
	} {
		header := contextJSON{"outcome_color": "#94a3b8"}
		contextOutcome(header, payload, tc.xuid)
		if header["outcome"] != tc.want || header["outcome_color_token"] != tc.token || header["outcome_color"] != tc.color || header["outcome_code"] == nil {
			t.Errorf("xuid %q: %v", tc.xuid, header)
		}
	}
	// No readable outcome: the neutral default stands.
	header := contextJSON{"outcome_color": "#94a3b8"}
	contextOutcome(header, map[string]any{"Players": []any{map[string]any{"PlayerId": "xuid(1)"}}}, "1")
	if header["outcome"] != nil || header["outcome_color"] != "#94a3b8" {
		t.Fatalf("absent outcome must not claim: %v", header)
	}
}

// TestContextScoreTimelineTokens pins the [score_timeline] table token matching on the RAW
// pair name (the API mode name, only the map suffix removed): whole words, the longest
// token wins, nothing else is normalized. The variant is usually the exact form
// ("Ranked:King of the Hill"); the playlist name is the fallback for a match whose variant
// is unreadable.
func TestContextScoreTimelineTokens(t *testing.T) {
	for _, tc := range []struct {
		label string
		want  any
	}{
		{"slayer", "hidden"},
		{"team snipers", "hidden"},
		{"ctf", "events"},
		{"neutral flag", "events"},
		{"king of the hill", "events"},
		{"koth", "events"},
		{"assault", "events"},
		{"neutral bomb", "events"},
		{"one bomb", "events"},
		{"ranked king of the hill on bazaar", "events"},
		{"super fiesta slayer on strike force", "hidden"},
		{"hustle ctf on bazaar", "events"},
		{"oddball on strike force", nil},
		{"strongholds on bazaar", nil},
		{"", nil},
	} {
		got := contextScoreTimelineToken(tc.label)
		if got != tc.want {
			t.Errorf("%q = %v, want %v", tc.label, got, tc.want)
		}
	}
}

// TestContextScoreTimelineKind pins the header field on the variant and its playlist-name
// fallback: an unknown variant and playlist keep the client default (absent, the "curve"
// the client computes by absence).
func TestContextScoreTimelineKind(t *testing.T) {
	for _, tc := range []struct {
		variant, playlist string
		want              any
	}{
		{"Ranked:King of the Hill", "", "events"},
		{"", "Ranked:King of the Hill on Bazaar", "events"},
		{"", "", nil},
	} {
		header := contextJSON{}
		contextScoreTimelineKind(header, tc.variant, tc.playlist)
		if header["score_timeline_kind"] != tc.want {
			t.Errorf("variant %q playlist %q = %v, want %v", tc.variant, tc.playlist, header["score_timeline_kind"], tc.want)
		}
	}
}

// TestContextRegulationSeconds pins the [regulation_seconds] table: the declared variants
// measure 720s, the rest carry no regulation reading at all.
func TestContextRegulationSeconds(t *testing.T) {
	for _, tc := range []struct {
		variant string
		want    int
		ok      bool
	}{
		{"Ranked:Slayer", 720, true},
		{"Strongholds:Arena", 720, true},
		{"CTF:Arena", 720, true},
		{"Arena:Oddball", 0, false},
		{"Ranked:King of the Hill", 0, false},
	} {
		got, ok := contextRegulationSeconds(tc.variant)
		if got != tc.want || ok != tc.ok {
			t.Errorf("%s = %d,%v, want %d,%v", tc.variant, got, ok, tc.want, tc.ok)
		}
	}
}

// TestContextCombatYield pins the combat-yield row fields: pure functions of the API
// CoreStats, zero counts leave the per-field reading absent, rounding is two decimals.
func TestContextCombatYield(t *testing.T) {
	row := contextJSON{}
	fillContextCombatYield(row, map[string]any{"Kills": float64(10), "Deaths": float64(6), "DamageDealt": float64(2455), "DamageTaken": float64(1830)})
	for key, want := range map[string]any{"damage_per_kill": 245.5, "damage_per_death": 305.0, "offensive_conversion": 0.63, "defensive_resistance": 0.38} {
		if row[key] != want {
			t.Errorf("%s = %v, want %v", key, row[key], want)
		}
	}
	row = contextJSON{}
	fillContextCombatYield(row, map[string]any{"Kills": float64(0), "Deaths": float64(0), "DamageDealt": float64(300), "DamageTaken": float64(100)})
	if row["damage_per_kill"] != nil || row["damage_per_death"] != nil || row["offensive_conversion"] != nil || row["defensive_resistance"] != nil {
		t.Fatalf("zero denominator must stay absent: %v", row)
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
	if err := root.WriteFile(path, gzipJSON(t, []byte(`{"killCauses":[{"feedMs":30000,"killer":"1","victim":"2"},{"feedMs":31000,"killer":"1","victim":"3"}]}`))); err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile(variantPath(root, "abc", "kill-details.json"), []byte(`[{"time_ms":30000,"killer":"1","assist_state":"named","assist_gamertag":"Helper","killer_damage_pct":75,"weapon_key":"hinf_br75"},{"time_ms":31000,"killer":"1","weapon_key":"hinf_s7_sniper"}]`)); err != nil {
		t.Fatal(err)
	}
	// The icon set's index.json: the weapon key -> contour file map the kill feed reads.
	// hinf_s7_sniper has no entry: that kill keeps its key and gets no icon URL.
	if err := root.WriteFile(filepath.Join(weaponicons.OutDir(root.Dir()), "index.json"), []byte(`[{"index":0,"style":"contour","file":"contour-00.png","arme":"hinf_br75","source_tag":"bc17adf1"},{"index":0,"style":"silhouette","file":"silhouette-00.png","arme":"hinf_br75"}]`)); err != nil {
		t.Fatal(err)
	}
	result, err := buildContext(root, "abc", "")
	if err != nil {
		t.Fatal(err)
	}
	events := result["highlight_events"].([]contextJSON)
	if len(events) != 2 || events[0]["assist_gamertag"] != "Helper" || events[0]["killer_damage_pct"] != 75 || events[0]["weapon_key"] != "hinf_br75" {
		t.Fatalf("events: %v", events)
	}
	if events[0]["weapon_image_url"] != "/static/weapons-assets/halo_infinite/jeu/contour-00.png" || events[0]["weapon_image_tinted"] != true {
		t.Fatalf("weapon icon: %v", events[0])
	}
	if events[1]["weapon_image_url"] != nil || events[1]["weapon_image_tinted"] != nil {
		t.Fatalf("unmapped key must carry no icon: %v", events[1])
	}
}

// TestContextKillDetailsAbsent pins the d01ba030 regression: a match whose film decode
// left no kill-details.json (stored before the build wrote it, or an unpublishable
// killsource) must still serve 200 with its kills, minus the weapon fields, and not
// turn the absence of the file into an error.
func TestContextKillDetailsAbsent(t *testing.T) {
	root := newFakeStore(t)
	path, _ := root.MatchReplayPath("abc")
	if err := root.WriteFile(path, gzipJSON(t, []byte(`{"killCauses":[{"feedMs":30000,"killer":"1","victim":"2"},{"feedMs":31000,"killer":"1","victim":"3"}]}`))); err != nil {
		t.Fatal(err)
	}
	result, err := buildContext(root, "abc", "")
	if err != nil {
		t.Fatalf("absent kill-details must not fail the context: %v", err)
	}
	events := result["highlight_events"].([]contextJSON)
	if len(events) != 2 {
		t.Fatalf("kills: %v", events)
	}
	for i, e := range events {
		for _, field := range []string{"weapon_key", "weapon_image_url", "weapon_image_tinted", "weapon_label", "assist_state", "assist_gamertag"} {
			if e[field] != nil {
				t.Fatalf("event %d: absent details must not stamp %s: %v", i, field, e)
			}
		}
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
	for key, want := range map[string]any{"avg_life_seconds": float64(29), "first_joined_time": "2026-01-01T00:00:20Z", "perfect_kills": float64(2)} {
		if row[key] != want {
			t.Errorf("%s = %v, want %v", key, row[key], want)
		}
	}
}

func TestContextWaypointURL(t *testing.T) {
	root := newFakeStore(t)
	if err := root.WriteFile(variantPath(root, "abc", "match.json"), []byte(`{"matchId":"abc","mapAssetId":"map"}`)); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`{"MatchInfo":{"MapVariant":{"AssetId":"map"}},"Players":[]}`)
	if err := root.WriteFile(variantPath(root, "abc", "stats-full.json"), raw); err != nil {
		t.Fatal(err)
	}
	rec := get(t, newTestHandlers(root, nil), "/api/matches/abc/context", nil)
	var got struct {
		Header map[string]any `json:"header"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Header["waypoint_url"] != "https://www.halowaypoint.com/halo-infinite/matches/abc" {
		t.Fatalf("response: %s", rec.Body.String())
	}
}

func TestContextMode(t *testing.T) {
	root := newFakeStore(t)
	raw := []byte(`{"MatchInfo":{"UgcGameVariant":{"PublicName":"Ranked:Oddball"}},"Players":[{"PlayerId":"xuid(1)","Gamertag":"A","PlayerTeamStats":[{"Stats":{"CoreStats":{"Kills":10,"Deaths":1,"Assists":3,"PersonalScore":1000,"KDA":10,"Accuracy":80,"DamageDealt":1000,"DamageTaken":300}}}]},{"PlayerId":"xuid(2)","Gamertag":"B","PlayerTeamStats":[{"Stats":{"CoreStats":{"Kills":1,"Deaths":10,"Assists":0,"PersonalScore":100,"KDA":-9,"Accuracy":20,"DamageDealt":200,"DamageTaken":1000}}}]}]}`)
	if err := root.WriteFile(variantPath(root, "abc", "stats-full.json"), raw); err != nil {
		t.Fatal(err)
	}
	rec := get(t, newTestHandlers(root, nil), "/api/matches/abc/context", nil)
	var got struct {
		Header     map[string]any   `json:"header"`
		Scoreboard []map[string]any `json:"scoreboard"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if got.Header["mode_ui"] != "Oddball" || got.Header["mode_category"] != "Ranked" || len(got.Scoreboard) != 2 {
		t.Fatalf("response: %s", rec.Body.String())
	}
}

func TestContextStaticAssets(t *testing.T) {
	root := newFakeStore(t)
	for _, p := range []string{"static/medals/halo_infinite/42.png", "static/maps/halo_infinite/map.png"} {
		if err := root.WriteFile(filepath.Join(root.Dir(), filepath.FromSlash(p)), []byte("image-data")); err != nil {
			t.Fatal(err)
		}
	}
	h := newTestHandlers(root, nil)
	for _, tc := range []struct {
		path string
		code int
	}{{"/static/medals/halo_infinite/42.png", 200}, {"/static/maps/halo_infinite/map.png", 200}, {"/static/medals/halo_infinite/99.png", 404}, {"/static/maps/halo_infinite/../match.json", 404}} {
		rec := get(t, h, tc.path, nil)
		if rec.Code != tc.code {
			t.Errorf("%s: %d", tc.path, rec.Code)
		}
		if tc.code == 200 && rec.Body.String() != "image-data" {
			t.Errorf("%s: %q", tc.path, rec.Body.String())
		}
	}
}

func TestContextCachedMetadata(t *testing.T) {
	root := newFakeStore(t)
	files := map[string]string{
		"stats-full.json":    `{"MatchInfo":{},"Players":[{"PlayerId":"xuid(1)","Gamertag":"A","PlayerTeamStats":[{"Stats":{"CoreStats":{"Kills":2,"Deaths":1,"Medals":[{"NameId":42,"Count":2}]}}}]}]}`,
		"skill.json":         `{"Value":[{"Id":"xuid(1)","ResultCode":0,"Result":{"StatPerformances":{"Kills":{"Expected":3.5,"StdDev":1.2},"Deaths":{"Expected":2.5,"StdDev":0.8}},"RankRecap":{"PreMatchCsr":{"Value":1500},"PostMatchCsr":{"Value":1505,"Tier":"Onyx","SubTier":0,"InitialMeasurementMatches":5}}}}]}`,
		"playlist.json":      `{"PublicName":"Ranked Arena"}`,
		"map-mode-pair.json": `{"PublicName":"Ranked:Oddball on Live Fire"}`,
	}
	for p, v := range files {
		if err := root.WriteFile(variantPath(root, "abc", p), []byte(v)); err != nil {
			t.Fatal(err)
		}
	}
	catalog := `{"Medals":[{"nameId":42,"name":{"value":"Test Medal"},"description":{"value":"Test description"},"difficultyIndex":1,"spriteIndex":0}]}`
	if err := root.WriteFile(filepath.Join(root.Dir(), "medals", "metadata.json"), []byte(catalog)); err != nil {
		t.Fatal(err)
	}
	rec := get(t, newTestHandlers(root, nil), "/api/matches/abc/context?xuid=1", nil)
	var got struct {
		Header     map[string]any   `json:"header"`
		Scoreboard []map[string]any `json:"scoreboard"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Scoreboard) != 1 {
		t.Fatalf("%s", rec.Body.String())
	}
	row := got.Scoreboard[0]
	medals, _ := row["medals"].([]any)
	rank, _ := row["skill_rank"].(map[string]any)
	if got.Header["is_ranked"] != true || got.Header["mode_ui"] != "Oddball" || got.Header["mode_category"] != "Ranked" || got.Header["playlist_label"] != "Ranked Arena" || row["expected_kills"] != 3.5 || row["deaths_stddev"] != 0.8 || rank["rating_value"] != float64(1505) || len(medals) != 1 || medals[0].(map[string]any)["label"] != "Test Medal" || medals[0].(map[string]any)["difficulty"] != "Heroic" {
		t.Fatalf("%s", rec.Body.String())
	}
}

func TestContextPlaylistLabel(t *testing.T) {
	for raw, want := range map[string]string{
		"Ranked Arena":      "Ranked Arena",
		"Ranked":            "Ranked",
		"Arena : Ascension": "Ascension",
		"arena":             "arena",
		"Super Fiesta":      "Super Fiesta",
		"Super Fiesta : X":  "X",
		"Fiesta":            "Fiesta",
		"Castle wars : X":   "X",
		"  Btb : X  ":       "X",
		"Tactical : X":      "X",
		"Community : X":     "X",
		"Firefight : X":     "X",
		"Armed Assault : X": "Armed Assault : X",
	} {
		if got := contextPlaylistLabel(raw); got != want {
			t.Errorf("%q = %q, want %q", raw, got, want)
		}
	}
}

// TestContextMedalOrder pins the medal sort rule: count descending, ties keep
// the stats-full array order. LevelUp applies no other sort (Q27BulkMedals
// orders by xuid, count DESC; ties keep medals_earned insertion order, which
// is the raw 343 stats payload order, internal/sync/transforms.go ExtractMedals).
func TestContextMedalOrder(t *testing.T) {
	root := newFakeStore(t)
	raw := []byte(`{"MatchInfo":{},"Players":[{"PlayerId":"xuid(1)","Gamertag":"A","PlayerTeamStats":[{"Stats":{"CoreStats":{"Kills":1,"Deaths":1,"Medals":[{"NameId":42,"Count":1},{"NameId":43,"Count":3},{"NameId":44,"Count":1}]}}}]}]}`)
	if err := root.WriteFile(variantPath(root, "abc", "stats-full.json"), raw); err != nil {
		t.Fatal(err)
	}
	catalog := `{"Medals":[{"nameId":42,"name":{"value":"A"},"difficultyIndex":0},{"nameId":43,"name":{"value":"B"},"difficultyIndex":1},{"nameId":44,"name":{"value":"C"},"difficultyIndex":0}]}`
	if err := root.WriteFile(filepath.Join(root.Dir(), "medals", "metadata.json"), []byte(catalog)); err != nil {
		t.Fatal(err)
	}
	rec := get(t, newTestHandlers(root, nil), "/api/matches/abc/context?xuid=1", nil)
	var got struct {
		Scoreboard []map[string]any `json:"scoreboard"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	medals, _ := got.Scoreboard[0]["medals"].([]any)
	want := []float64{43, 42, 44}
	if len(medals) != len(want) {
		t.Fatalf("medals: %v", medals)
	}
	for i, id := range want {
		if medals[i].(map[string]any)["medal_id"] != id {
			t.Fatalf("medal order: %v", medals)
		}
	}
}

func TestContextMedalDifficulty(t *testing.T) {
	for index, want := range map[int]string{0: "Normal", 1: "Heroic", 2: "Legendary", 3: "Mythic", -1: "Normal", 9: "Normal"} {
		if got := contextMedalDifficulty(index); got != want {
			t.Errorf("index %d = %q, want %q", index, got, want)
		}
	}
}

func TestContextMedalEventMetadata(t *testing.T) {
	root := newFakeStore(t)
	if err := root.WriteFile(variantPath(root, "abc", "events.json"), []byte(`[{"XUID":1,"EventType":"medal","TimeMS":1000,"TypeHint":50,"MedalType":26}]`)); err != nil {
		t.Fatal(err)
	}
	catalog := `{"Medals":[{"nameId":42,"name":{"value":"Killjoy"},"description":{"value":"End a spree"},"difficultyIndex":0}]}`
	if err := root.WriteFile(filepath.Join(root.Dir(), "medals", "metadata.json"), []byte(catalog)); err != nil {
		t.Fatal(err)
	}
	rec := get(t, newTestHandlers(root, nil), "/api/matches/abc/context", nil)
	var got struct {
		Events []map[string]any `json:"highlight_events"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Events) != 1 || got.Events[0]["medal_name_id"] != float64(42) || got.Events[0]["medal_label"] != "Killjoy" || got.Events[0]["medal_description"] != "End a spree" || got.Events[0]["medal_image_url"] != "/static/medals/halo_infinite/42.png" {
		t.Fatalf("%s", rec.Body.String())
	}
}
