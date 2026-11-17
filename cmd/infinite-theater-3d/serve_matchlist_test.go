// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_matchlist_test.go — the match-list enrichment (brief 122): the list fields a
// match-select row needs, the signed-in account's outcome and score, the no-context-data
// fallback, and the remote entries' map asset id and stored map image. No network, no real
// token.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/haloapi"
	"github.com/llampwall/infinite-theater-3d/internal/haloauth"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// listMatchFullStats is a small stats-full.json payload (the shape matchFacts reads): one
// map, one mode, one player with an outcome, and the per-team final scores.
const listMatchFullStats = `{
  "MatchInfo": {
    "StartTime": "2026-02-01T00:00:00Z",
    "MapVariant": {"AssetId": "mapasset", "VersionId": "v1"},
    "UgcGameVariant": {"PublicName": "Slayer"},
    "Playlist": {"PublicName": "Firefight: Slayer"}
  },
  "Players": [
    {"PlayerId": "xuid(1)", "Gamertag": "Alpha", "LastTeamId": 0, "Outcome": 2,
     "PlayerTeamStats": [{"Stats": {"CoreStats": {"Kills": 5, "Deaths": 3, "Assists": 2}}}]}
  ],
  "Teams": [
    {"TeamId": 0, "Stats": {"CoreStats": {"Score": 50}}},
    {"TeamId": 1, "Stats": {"CoreStats": {"Score": 40}}}
  ]
}`

func writeListMatchFiles(t *testing.T, root *store.Root, matchID string, meta store.Match) {
	t.Helper()
	if err := root.SaveMatchMeta(matchID, meta); err != nil {
		t.Fatal(err)
	}
	metaPath, err := root.MatchMetaPath(matchID)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Dir(metaPath)
	for name, data := range map[string]string{
		"stats.json":      `{"gameVariantName":"Slayer","teamScores":[50,40]}`,
		"stats-full.json": listMatchFullStats,
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(data), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func listSummaryRows(t *testing.T, h http.Handler) []map[string]any {
	t.Helper()
	rec := get(t, h, "/api/matches", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var rows []map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	return rows
}

// TestMatchesListCarriesContextFields — the new list fields are present for a stored match
// with context data, derived from the same stored data the context header reads.
func TestMatchesListCarriesContextFields(t *testing.T) {
	root := newFakeStore(t)
	writeListMatchFiles(t, root, "abc", store.Match{
		MatchID: "abc", MapName: "Test Map", MapAssetID: "mapasset", MapModule: "moda",
		Build: "HI_1_13_0", DurationMS: 4200, ImportedAt: "2026-01-01T00:00:00Z",
	})
	rows := listSummaryRows(t, newTestHandlers(root, nil))
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
	row := rows[0]
	if got, _ := row["modeName"].(string); got != "Slayer" {
		t.Errorf("modeName = %q, want %q; row=%s", got, "Slayer", row)
	}
	if got, _ := row["playlistName"].(string); got != "Firefight: Slayer" {
		t.Errorf("playlistName = %q, want %q", got, "Firefight: Slayer")
	}
	if got, _ := row["startTime"].(string); got != "2026-02-01T00:00:00Z" {
		t.Errorf("startTime = %q", got)
	}
	scores, ok := row["teamScores"].([]any)
	if !ok || len(scores) != 2 || scores[0] != float64(50) || scores[1] != float64(40) {
		t.Errorf("teamScores = %v", row["teamScores"])
	}
	for _, field := range []string{"outcome", "scoreMine", "scoreTheirs"} {
		if _, present := row[field]; present {
			t.Errorf("%s must be absent without a signed-in account: %s", field, row)
		}
	}
	raw, _ := json.Marshal(row)
	t.Logf("example summary: %s", raw)
}

// TestMatchesListOutcomeForSignedInAccount — the outcome and score fields appear only for a
// signed-in account that is in the match, from that player's point of view.
func TestMatchesListOutcomeForSignedInAccount(t *testing.T) {
	root := newFakeStore(t)
	writeListMatchFiles(t, root, "abc", store.Match{
		MatchID: "abc", MapName: "Test Map", MapAssetID: "mapasset", MapModule: "moda",
		Build: "HI_1_13_0", DurationMS: 4200, ImportedAt: "2026-01-01T00:00:00Z",
	})
	h := newTestHandlers(root, nil)

	if rows := listSummaryRows(t, h); len(rows) == 1 {
		if _, present := rows[0]["outcome"]; present {
			t.Fatalf("outcome present without account: %s", rows[0])
		}
	}

	// Signed in as "Alpha" (in the match, team 0, outcome win): the fields appear.
	h.auth.gamer = "Alpha"
	rows := listSummaryRows(t, h)
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
	row := rows[0]
	if got, _ := row["outcome"].(string); got != "win" {
		t.Errorf("outcome = %q, want win; row=%s", got, row)
	}
	if row["scoreMine"] != float64(50) {
		t.Errorf("scoreMine = %v, want 50", row["scoreMine"])
	}
	if row["scoreTheirs"] != float64(40) {
		t.Errorf("scoreTheirs = %v, want 40", row["scoreTheirs"])
	}

	// Signed in as "Bravo" (not in the match): the fields are absent again.
	h.auth.gamer = "Bravo"
	rows = listSummaryRows(t, h)
	if len(rows) == 1 {
		if _, present := rows[0]["outcome"]; present {
			t.Fatalf("outcome present for a player not in the match: %s", rows[0])
		}
	}
}

// TestMatchesListWithoutContextData — a match with no stored context data keeps today's
// fields and omits the new ones; the list still answers 200 with the row. A fresh store is
// used so the only match present is the bare one (no stats-full.json).
func TestMatchesListWithoutContextData(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	bare := "deadbeef-0000-0000-0000-000000000000"
	if err := root.SaveMatchMeta(bare, store.Match{
		MatchID: bare, MapName: "Bare Map", MapModule: "modb",
		Build: "HI_1_13_0", DurationMS: 1000, ImportedAt: "2026-01-02T00:00:00Z",
	}); err != nil {
		t.Fatal(err)
	}
	rows := listSummaryRows(t, newTestHandlers(root, nil))
	if len(rows) != 1 {
		t.Fatalf("want 1 row, got %d", len(rows))
	}
	row := rows[0]
	if row["matchId"] != bare || row["mapName"] != "Bare Map" {
		t.Fatalf("stored fields missing: %s", row)
	}
	for _, field := range []string{"modeName", "playlistName", "startTime", "teamScores", "outcome", "scoreMine"} {
		if _, present := row[field]; present {
			t.Errorf("%s must be absent for a match without context data: %s", field, row)
		}
	}
}

// TestRemoteMatchesCarryMapAssetAndImage — the remote entry carries the map asset id from
// the service response and the stored map image URL (the same URL form as the context
// route), with no extra network request.
func TestRemoteMatchesCarryMapAssetAndImage(t *testing.T) {
	root := newFakeStore(t)
	if err := os.MkdirAll(filepath.Join(root.Dir(), "static", "maps", "halo_infinite"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root.Dir(), "static", "maps", "halo_infinite", "mapasset.png"), []byte("img"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A second asset id with no stored image: mapAssetId is carried, mapImageUrl is empty.

	svc := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/players/xuid(x1)/matches" {
			fmt.Fprint(w, `{"Results":[
				{"MatchId":"m1","MatchInfo":{"StartTime":"2026-02-02T00:00:00Z",
					"MapVariant":{"AssetId":"mapasset","VersionId":"v1","PublicName":"The Pit"},
					"UgcGameVariant":{"AssetId":"mode1","VersionId":"v1","PublicName":"Slayer"}}},
				{"MatchId":"m2","MatchInfo":{"StartTime":"2026-02-03T00:00:00Z",
					"MapVariant":{"AssetId":"noimage","VersionId":"v1","PublicName":"Other"},
					"UgcGameVariant":{"AssetId":"mode2","VersionId":"v1","PublicName":"Oddball"}}}]}`)
			return
		}
		http.NotFound(w, r)
	}))
	defer svc.Close()

	h := newTestHandlers(root, nil)
	api := haloapi.New(svc.Client(), haloapi.Endpoints{Stats: svc.URL, Discovery: svc.URL, Economy: svc.URL}, "synthetic", "synthetic")
	h.remote.client = func(context.Context) (*haloapi.Client, haloauth.Credentials, error) {
		return api, haloauth.Credentials{XUID: "x1"}, nil
	}
	rec := get(t, h, "/api/remote/matches", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var rows []haloapi.Match
	if err := json.Unmarshal(rec.Body.Bytes(), &rows); err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 {
		t.Fatalf("want 2 rows, got %d", len(rows))
	}
	if rows[0].MapAssetID != "mapasset" {
		t.Errorf("mapAssetId = %q, want mapasset", rows[0].MapAssetID)
	}
	if rows[0].MapImageURL != "/static/maps/halo_infinite/mapasset.png" {
		t.Errorf("mapImageUrl = %q, want /static/maps/halo_infinite/mapasset.png", rows[0].MapImageURL)
	}
	if rows[1].MapAssetID != "noimage" {
		t.Errorf("mapAssetId = %q, want noimage", rows[1].MapAssetID)
	}
	if rows[1].MapImageURL != "" {
		t.Errorf("mapImageUrl = %q, want empty for an unstored image", rows[1].MapImageURL)
	}
	raw, _ := json.Marshal(rows[0])
	t.Logf("example remote entry: %s", raw)
}
