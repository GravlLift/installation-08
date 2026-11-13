package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

func TestContextFilmEvents(t *testing.T) {
	root := newFakeStore(t)
	raw := `[{"XUID":1,"Gamertag":"A","EventType":"death","TimeMS":22000},{"XUID":1,"Gamertag":"A","EventType":"kill","TimeMS":21000},{"XUID":1,"Gamertag":"A","EventType":"medal","TimeMS":23000},{"XUID":1,"Gamertag":"A","EventType":"mode","TimeMS":24000},{"XUID":1,"EventType":"kill","TimeMS":1000}]`
	if err := root.WriteFile(variantPath(root, "abc", "events.json"), []byte(raw)); err != nil {
		t.Fatal(err)
	}
	stats, err := os.ReadFile(filepath.Join("testdata", "context", "stats-full.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := root.WriteFile(variantPath(root, "abc", "stats-full.json"), stats); err != nil {
		t.Fatal(err)
	}
	rec := get(t, newTestHandlers(root, nil), "/api/matches/abc/context", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Events []struct {
			Type string `json:"event_type"`
			Time int    `json:"event_time_ms"`
		} `json:"highlight_events"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if len(got.Events) != 4 {
		t.Fatalf("events: %s", rec.Body.String())
	}
	for i, want := range []string{"kill", "death", "medal", "mode"} {
		if got.Events[i].Type != want || got.Events[i].Time != (i+1)*1000 {
			t.Fatalf("events: %+v", got.Events)
		}
	}
}

func TestContextFilmT0OverridesStats(t *testing.T) {
	root := newFakeStore(t)
	path, _ := root.MatchReplayPath("abc")
	if err := root.WriteFile(path, gzipJSON(t, []byte(`{"t0FilmMs":15000}`))); err != nil {
		t.Fatal(err)
	}
	raw := `[{"XUID":1,"EventType":"kill","TimeMS":21000}]`
	if err := root.WriteFile(variantPath(root, "abc", "events.json"), []byte(raw)); err != nil {
		t.Fatal(err)
	}
	rec := get(t, newTestHandlers(root, nil), "/api/matches/abc/context", nil)
	var got struct {
		Header struct {
			T0 int `json:"t0_ms"`
		} `json:"header"`
		Events []struct {
			Time int `json:"event_time_ms"`
		} `json:"highlight_events"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusOK || got.Header.T0 != 15000 || len(got.Events) != 1 || got.Events[0].Time != 6000 {
		t.Fatalf("context: %s", rec.Body.String())
	}
}
