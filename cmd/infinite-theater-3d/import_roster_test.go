package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
)

// A roster entry whose team the film left unnamed takes the team from Halo's match stats
// (27de812c: Mikeyy AB listed on team 0, making a 4v4 read 5v3).
func TestRosterOfFallsBackToStatsTeam(t *testing.T) {
	zero, one := 0, 1
	doc := replay.ReplayDocument{Roster: []replay.RosterEntry{
		{XUID: "1", Name: "A", Team: &zero},
		{XUID: "2", Name: "B"},
		{XUID: "3", Name: "C", Team: &one},
		{XUID: "4", Name: "D"},
	}}
	stats := filepath.Join(t.TempDir(), "stats.json")
	body := `{"players":[{"xuid":"1","teamId":0},{"xuid":"2","teamId":1},{"xuid":"3","teamId":0}]}`
	if err := os.WriteFile(stats, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	got := rosterOf(doc, stats)
	want := map[string]int{"1": 0, "2": 1, "3": 1, "4": 0}
	for _, p := range got {
		if p.TeamID != want[p.XUID] {
			t.Errorf("player %s: team %d, want %d", p.XUID, p.TeamID, want[p.XUID])
		}
	}
}
