package main

import (
	"encoding/json"
	"errors"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/JGtm/halo-infinite-film-decoder/highlightevent"
	"github.com/llampwall/infinite-theater-3d/internal/build"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

func contextFilmT0(root *store.Root, id string) (int64, bool) {
	raw, err := root.LoadReplay(id)
	if err != nil {
		return 0, false
	}
	decoded, err := gunzipBytes(raw)
	if err != nil {
		return 0, false
	}
	var doc contextDocument
	if json.Unmarshal(decoded, &doc) != nil || doc.T0FilmMS == nil {
		return 0, false
	}
	return *doc.T0FilmMS, true
}

func contextSidecarEvents(root *store.Root, id string, rows []contextJSON, t0 int64) ([]contextJSON, bool, error) {
	raw, err := os.ReadFile(variantPath(root, id, "events.json"))
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	var source []highlightevent.HighlightEvent
	if err := json.Unmarshal(raw, &source); err != nil {
		return nil, false, err
	}
	if source == nil {
		return nil, false, nil
	}
	sort.SliceStable(source, func(i, j int) bool { return source[i].TimeMS < source[j].TimeMS })
	events := make([]contextJSON, 0, len(source))
	for _, e := range source {
		tm := int64(e.TimeMS) - t0
		if tm < 0 {
			continue
		}
		xuid := strconv.FormatUint(e.XUID, 10)
		event := contextJSON{"event_type": e.EventType, "event_time_ms": tm, "actor_xuid": xuid}
		for _, row := range rows {
			if textValue(row["xuid"]) == xuid {
				if team, err := strconv.Atoi(strings.TrimPrefix(textValue(row["team_side"]), "t")); err == nil {
					event["actor_team_id"] = team
				}
				if name := textValue(row["gamertag"]); name != "" {
					event["actor_gamertag"] = name
				}
				break
			}
		}
		if e.EventType == "medal" {
			if name, ok := build.MedalName(e.TypeHint, e.MedalType); ok {
				event["medal_name"] = name
			}
		}
		events = append(events, event)
	}
	return events, true, nil
}

func contextEvents(root *store.Root, id string, rows []contextJSON, t0 int64) ([]contextJSON, error) {
	events, found, err := contextSidecarEvents(root, id, rows, t0)
	if err != nil {
		return nil, err
	}
	if !found {
		return contextDocumentEvents(root, id, rows, t0)
	}
	kills, err := contextDocumentEvents(root, id, rows, t0)
	if err != nil {
		return nil, err
	}
	byKey := make(map[contextKillKey]contextJSON)
	for _, kill := range kills {
		byKey[contextKillKey{textValue(kill["actor_xuid"]), kill["event_time_ms"].(int64)}] = kill
	}
	for _, event := range events {
		if event["event_type"] != "kill" {
			continue
		}
		key := contextKillKey{textValue(event["actor_xuid"]), event["event_time_ms"].(int64)}
		for k, v := range byKey[key] {
			if k != "event_type" && k != "event_time_ms" && k != "actor_xuid" {
				event[k] = v
			}
		}
	}
	if err := decorateContextKills(root, id, events, rows, t0); err != nil {
		return nil, err
	}
	return events, nil
}
