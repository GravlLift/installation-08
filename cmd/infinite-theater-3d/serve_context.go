package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

type contextJSON map[string]any

type contextDocument struct {
	T0FilmMS   *int64 `json:"t0FilmMs"`
	KillCauses []struct {
		FeedMS   int    `json:"feedMs"`
		Killer   string `json:"killer"`
		Victim   string `json:"victim"`
		Category string `json:"category"`
	} `json:"killCauses"`
}

func (h serverHandlers) handleContext(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !store.MatchIDValid(id) {
		writeJSON(w, http.StatusBadRequest, contextJSON{"error": "invalid match id"})
		return
	}
	result, err := buildContext(h.root, id, r.URL.Query().Get("xuid"))
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(w, http.StatusNotFound, contextJSON{"error": "match_not_found", "id": id})
		} else {
			slog.Error("build match context", "id", id, "err", err)
			writeJSON(w, http.StatusInternalServerError, contextJSON{"error": "context unavailable"})
		}
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func buildContext(root *store.Root, id, xuid string) (contextJSON, error) {
	meta, err := root.MatchMeta(id)
	if err != nil {
		return nil, err
	}
	var stats build.Stats
	raw, err := os.ReadFile(variantPath(root, id, "stats.json"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if err == nil {
		if err = json.Unmarshal(raw, &stats); err != nil {
			return nil, err
		}
	}
	full, err := os.ReadFile(variantPath(root, id, "stats-full.json"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	var payload map[string]any
	if err == nil {
		if err = json.Unmarshal(full, &payload); err != nil {
			return nil, err
		}
		facts, _, _, e := matchFacts(full)
		if e != nil {
			return nil, e
		}
		if facts.GameVariantName == "" {
			facts.GameVariantName = stats.GameVariantName
		}
		stats = facts
	}
	rows := contextRows(meta, stats, payload, xuid)
	header := contextHeader(meta, stats, payload, xuid)
	_, err = os.Stat(variantPath(root, id, "replay.json.gz"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	header["replay_available"] = err == nil
	t0 := contextT0(payload)
	if filmT0, ok := contextFilmT0(root, id); ok {
		t0 = filmT0
	}
	if t0 > 0 {
		header["t0_ms"] = t0
	}
	contextTiming(header, payload, t0)
	events, err := contextEvents(root, id, rows, t0)
	if err != nil {
		return nil, err
	}
	result := contextJSON{"header": header, "scoreboard": rows, "highlight_events": events, "media": contextJSON{"media_items": []any{}}, "source_unavailable": false}
	switch stats.GameVariantName {
	case "CTF:Arena", "CTF:Arena Neutral Flag", "Team Slayer:Arena", "Slayer:Arena", "Slayer:Arena Super Fiesta", "Slayer:Arena Tactical", "Strongholds:Arena", "Arena:Slayer", "Arena:Team Slayer", "Ranked:Slayer":
		result["regulation_seconds"] = 720
	}
	return result, nil
}

func contextRows(meta store.Match, stats build.Stats, payload map[string]any, xuid string) []contextJSON {
	players := stats.Players
	if len(players) == 0 {
		for _, p := range meta.Players {
			players = append(players, build.StatsPlayer{Name: p.Name, XUID: p.XUID, TeamID: p.TeamID})
		}
	}
	rows := make([]contextJSON, 0, len(players))
	for _, p := range players {
		row := contextJSON{"xuid": p.XUID, "gamertag": p.Name, "team_side": fmt.Sprintf("t%d", p.TeamID), "is_me": xuid != "" && xuid == p.XUID}
		for _, roster := range meta.Players {
			if roster.XUID == p.XUID {
				if row["gamertag"] == "" {
					row["gamertag"] = roster.Name
				}
				if roster.IsBot {
					row["is_bot"] = true
				}
				break
			}
		}
		if len(stats.Players) > 0 {
			row["kills"], row["deaths"], row["assists"] = p.Kills, p.Deaths, p.Assists
		}
		fillFullRow(row, payload, p.XUID)
		rows = append(rows, row)
	}
	return rows
}

func object(v any) map[string]any { m, _ := v.(map[string]any); return m }
func array(v any) []any           { a, _ := v.([]any); return a }
func textValue(v any) string      { s, _ := v.(string); return s }
func fillFullRow(row contextJSON, payload map[string]any, xuid string) {
	for _, value := range array(payload["Players"]) {
		p := object(value)
		if strings.TrimSuffix(strings.TrimPrefix(textValue(p["PlayerId"]), "xuid("), ")") != xuid {
			continue
		}
		if v, ok := p["Rank"]; ok {
			row["rank"] = v
		}
		if code, ok := p["Outcome"].(float64); ok {
			if outcome := map[int]string{1: "tie", 2: "win", 3: "loss", 4: "dnf"}[int(code)]; outcome != "" {
				row["outcome"] = outcome
			}
		}
		participation := object(p["ParticipationInfo"])
		for source, dest := range map[string]string{"JoinedInProgress": "joined_in_progress", "LeftInProgress": "left_in_progress", "FirstJoinedTime": "first_joined_time", "LastLeaveTime": "last_leave_time"} {
			if v, ok := participation[source]; ok && v != nil {
				if source == "FirstJoinedTime" || source == "LastLeaveTime" {
					if t, err := time.Parse(time.RFC3339Nano, textValue(v)); err == nil {
						v = t.UTC().Format(time.RFC3339)
					}
				}
				row[dest] = v
			}
		}
		for _, team := range array(p["PlayerTeamStats"]) {
			bundle := object(object(team)["Stats"])
			core := object(bundle["CoreStats"])
			if core == nil {
				continue
			}
			fillContextObjective(row, bundle)
			fillContextMedals(row, core)
			if seconds, ok := contextDuration(textValue(core["AverageLifeDuration"])); ok {
				row["avg_life_seconds"] = int64(seconds)
			}
			for source, dest := range map[string]string{"PersonalScore": "score", "KDA": "kda", "Accuracy": "accuracy", "DamageDealt": "damage_dealt", "DamageTaken": "damage_taken", "ShotsFired": "shots_fired", "ShotsHit": "shots_hit", "HeadshotKills": "headshot_kills", "MaxKillingSpree": "max_killing_spree", "GrenadeKills": "grenade_kills", "MeleeKills": "melee_kills", "PowerWeaponKills": "power_weapon_kills"} {
				if v, ok := core[source]; ok && v != nil {
					row[dest] = v
				}
			}
			contextCombatYield(row)
			break
		}
		break
	}
}

func contextHeader(meta store.Match, stats build.Stats, payload map[string]any, xuid string) contextJSON {
	h := contextJSON{"match_id": meta.MatchID, "start_time_label": "", "outcome_color": "#94a3b8", "dominance_flag": false, "had_bot_teammate": false, "map_ui": meta.MapName, "mode_ui": stats.GameVariantName, "playlist_label": "", "performance_display": "-", "is_excluded": false, "is_ranked": false, "is_favorite": false, "replay_available": true}
	if meta.MapAssetID != "" {
		h["map_id"] = meta.MapAssetID
		// LevelUp apps/go-api/internal/games/halo_infinite/adapter_asset_urls.go.
		h["waypoint_url"] = "https://www.halowaypoint.com/halo-infinite/matches/" + meta.MatchID
	}
	contextScore(h, stats, payload, xuid)
	info := object(payload["MatchInfo"])
	if start := textValue(info["StartTime"]); start != "" {
		h["start_time"] = start
		if t, err := time.Parse(time.RFC3339Nano, start); err == nil {
			h["start_time_label"] = t.Local().Format("02 Jan 2006, 15:04")
		}
	}
	if name := textValue(object(info["Playlist"])["PublicName"]); name != "" {
		h["playlist_label"] = name
	}
	for _, value := range array(payload["Players"]) {
		p := object(value)
		if xuid == "" || textValue(p["PlayerId"]) != "xuid("+xuid+")" {
			continue
		}
		code, _ := p["Outcome"].(float64)
		switch int(code) {
		case 1:
			h["outcome_code"], h["outcome"], h["outcome_color"], h["outcome_color_token"] = 1, "tie", "#8b5cf6", "outcome-draw"
		case 2:
			h["outcome_code"], h["outcome"], h["outcome_color"], h["outcome_color_token"] = 2, "win", "#22c55e", "outcome-win"
		case 3:
			h["outcome_code"], h["outcome"], h["outcome_color"], h["outcome_color_token"] = 3, "loss", "#ef4444", "outcome-loss"
		case 4:
			h["outcome_code"], h["outcome"], h["outcome_color"], h["outcome_color_token"] = 4, "dnf", "#8b5cf6", "outcome-dnf"
		}
		break
	}
	return h
}

func contextDocumentEvents(root *store.Root, id string, rows []contextJSON, t0 int64) ([]contextJSON, error) {
	events := []contextJSON{}
	raw, err := root.LoadReplay(id)
	if errors.Is(err, store.ErrNotFound) {
		return events, nil
	}
	if err != nil {
		return nil, err
	}
	decoded, err := gunzipBytes(raw)
	if err != nil {
		return nil, err
	}
	var doc contextDocument
	if err = json.Unmarshal(decoded, &doc); err != nil {
		return nil, err
	}
	names := map[string]string{}
	teams := map[string]int{}
	for _, row := range rows {
		xuid := textValue(row["xuid"])
		names[xuid] = textValue(row["gamertag"])
		if team, err := strconv.Atoi(strings.TrimPrefix(textValue(row["team_side"]), "t")); err == nil {
			teams[xuid] = team
		}
	}
	for _, kill := range doc.KillCauses {
		if int64(kill.FeedMS) < t0 {
			continue
		}
		event := contextJSON{"event_type": "kill", "event_time_ms": int64(kill.FeedMS) - t0, "actor_xuid": kill.Killer}
		if name := names[kill.Killer]; name != "" {
			event["actor_gamertag"] = name
		}
		if team, ok := teams[kill.Killer]; ok {
			event["actor_team_id"] = team
		}
		if kill.Victim != "" {
			event["victim_xuid"] = kill.Victim
			if name := names[kill.Victim]; name != "" {
				event["victim_gamertag"] = name
			}
			if team, ok := teams[kill.Victim]; ok {
				event["victim_team_id"] = team
			}
		}
		if kill.Category != "" {
			event["headshot"] = kill.Category == "Headshot"
		}
		events = append(events, event)
	}
	if err := decorateContextKills(root, id, events, rows, t0); err != nil {
		return nil, err
	}
	return events, nil
}

var isoDuration = regexp.MustCompile(`^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$`)

func contextTiming(header contextJSON, payload map[string]any, t0 int64) {
	info := object(payload["MatchInfo"])
	duration := textValue(info["Duration"])
	if duration == "" {
		duration = textValue(info["PlayableDuration"])
		t0 = 0
	}
	m := isoDuration.FindStringSubmatch(duration)
	if m == nil {
		return
	}
	hours, _ := strconv.ParseFloat(m[1], 64)
	minutes, _ := strconv.ParseFloat(m[2], 64)
	seconds, _ := strconv.ParseFloat(m[3], 64)
	value := int64(hours*3600+minutes*60+seconds) - t0/1000
	if value < 0 {
		value = 0
	}
	header["playable_duration_seconds"] = value
}

func contextT0(payload map[string]any) int64 {
	start, err := time.Parse(time.RFC3339Nano, textValue(object(payload["MatchInfo"])["StartTime"]))
	if err != nil {
		return 0
	}
	var joins []int64
	for _, v := range array(payload["Players"]) {
		p := object(v)
		info := object(p["ParticipationInfo"])
		if !strings.HasPrefix(textValue(p["PlayerId"]), "xuid(") || info["PresentAtBeginning"] != true {
			continue
		}
		joined, e := time.Parse(time.RFC3339Nano, textValue(info["FirstJoinedTime"]))
		if e == nil {
			joins = append(joins, joined.UnixMilli())
		}
	}
	if len(joins) == 0 {
		return 0
	}
	sort.Slice(joins, func(i, j int) bool { return joins[i] < joins[j] })
	v := joins[0]
	if joins[len(joins)-1]-v > 2000 {
		v = joins[len(joins)/2]
		if len(joins)%2 == 0 {
			v = (v + joins[len(joins)/2-1]) / 2
		}
	}
	t0 := v - start.UnixMilli()
	if t0 < 0 || t0 > 120000 {
		return 0
	}
	return t0
}
