// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// TestServeCallouts — a match is answered with its map's cached named areas; a map not cached
// with no game to read is a JSON 404 naming the reason, an unknown match a match_not_found.
func TestServeCallouts(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for id, module := range map[string]string{"abc": "sgh_blueprint", "def": "sgh_streets"} {
		if err := root.SaveMatchMeta(id, store.Match{MatchID: id, MapName: "M", MapModule: module, ImportedAt: "2026-01-01T00:00:00Z"}); err != nil {
			t.Fatal(err)
		}
	}
	dir := filepath.Join(root.Dir(), "assets", "callouts")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	cached := `{"version":1,"source":"level","zones":[{"en":"Overhang","polygon":[[0,0],[1,0],[1,1]],"zBottom":4.31,"zTop":6.31}]}`
	if err := os.WriteFile(filepath.Join(dir, "sgh_blueprint.json"), []byte(cached), 0o644); err != nil {
		t.Fatal(err)
	}
	h := newTestHandlers(root, nil)
	h.callouts.game = t.TempDir() // a folder without pc/: no game
	if rec := get(t, h, "/api/matches/abc/callouts", nil); rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"en":"Overhang"`) {
		t.Fatalf("cached map: %d %s", rec.Code, rec.Body.String())
	}
	if rec := get(t, h, "/api/matches/def/callouts", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "no_game") {
		t.Fatalf("no game: %d %s", rec.Code, rec.Body.String())
	}
	if rec := get(t, h, "/api/matches/fff/callouts", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "match_not_found") {
		t.Fatalf("unknown match: %d %s", rec.Code, rec.Body.String())
	}
}
