// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/ambience"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// TestServeAmbience — a match is answered with its map's bed from the ambience manifest
// (range-capable); a map without a bed, or a library not built, is a JSON 404 naming the module.
func TestServeAmbience(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for id, module := range map[string]string{"abc": "fo09_academy", "def": "sgh_streets"} {
		if err := root.SaveMatchMeta(id, store.Match{MatchID: id, MapName: "M", MapModule: module, ImportedAt: "2026-01-01T00:00:00Z"}); err != nil {
			t.Fatal(err)
		}
	}
	h := newTestHandlers(root, nil)
	if rec := get(t, h, "/api/matches/abc/ambience.ogg", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "ambience_not_built") {
		t.Fatalf("library not built: %d %s", rec.Code, rec.Body.String())
	}
	writeSoundManifest(t, root.Dir(), ambience.ManifestName, map[string]any{"version": ambience.ManifestVersion, "maps": map[string]any{
		"fo09_academy": map[string]any{"loop": "5d6cc1cb", "zones": 2, "beds": 1, "takes": []any{
			map[string]any{"file": "ambience_3475f271.ogg", "media": 880145009, "durationMs": 54784, "channels": 4},
		}},
	}})
	if err := os.WriteFile(filepath.Join(soundsDir(root.Dir()), "ambience_3475f271.ogg"), []byte("OggS-bed"), 0o644); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/matches/abc/ambience.ogg", nil)
	req.Header.Set("Range", "bytes=0-3")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "OggS" || rec.Header().Get("Content-Type") != "audio/ogg" {
		t.Fatalf("bed: %d %q %s", rec.Code, rec.Body.String(), rec.Header().Get("Content-Type"))
	}
	if rec := get(t, h, "/api/matches/def/ambience.ogg", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "sgh_streets") {
		t.Fatalf("map without a bed: %d %s", rec.Code, rec.Body.String())
	}
	if rec := get(t, h, "/api/matches/fff/ambience.ogg", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "match_not_found") {
		t.Fatalf("unknown match: %d %s", rec.Code, rec.Body.String())
	}
}

// TestServeAmbienceLayoutAndTakes — ambience.json answers a match with its map layout
// (fallback, per-loop take files, zone shapes), and ambience/{file} serves one take file that
// the layout lists; an unlisted file, a traversal, a map without a bed, and an unknown match
// are JSON 404s.
func TestServeAmbienceLayoutAndTakes(t *testing.T) {
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for id, module := range map[string]string{"abc": "fo09_academy", "def": "sgh_streets"} {
		if err := root.SaveMatchMeta(id, store.Match{MatchID: id, MapName: "M", MapModule: module, ImportedAt: "2026-01-01T00:00:00Z"}); err != nil {
			t.Fatal(err)
		}
	}
	writeSoundManifest(t, root.Dir(), ambience.ManifestName, map[string]any{"version": ambience.ManifestVersion, "maps": map[string]any{
		"fo09_academy": map[string]any{
			"loop": "5d6cc1cb", "zones": 2, "beds": 2,
			"takes": []any{
				map[string]any{"file": "ambience_3475f271.ogg", "media": 880145009, "durationMs": 54784, "channels": 4},
			},
			"loops": map[string]any{
				"5d6cc1cb": []any{map[string]any{"file": "ambience_3475f271.ogg", "media": 880145009, "durationMs": 54784, "channels": 4}},
				"0602311e": []any{map[string]any{"file": "ambience_00000001.ogg", "media": 1, "durationMs": 1000, "channels": 4}},
			},
			"shapes": []any{
				map[string]any{"zone": 0, "loop": "5d6cc1cb", "floor": 0, "height": 250, "points": [][2]float64{{-250, -250}, {250, 250}}},
			},
		},
	}})
	for _, name := range []string{"ambience_3475f271.ogg", "ambience_00000001.ogg"} {
		if err := os.WriteFile(filepath.Join(soundsDir(root.Dir()), name), []byte("OggS-bed"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	h := newTestHandlers(root, nil)

	// ambience.json: 200 with fallback, files and zones.
	rec := get(t, h, "/api/matches/abc/ambience.json", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("ambience.json: %d %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["fallback"] != "5d6cc1cb" {
		t.Fatalf("fallback %v", body["fallback"])
	}
	files, _ := body["files"].(map[string]any)
	if files["5d6cc1cb"] != "ambience_3475f271.ogg" || files["0602311e"] != "ambience_00000001.ogg" {
		t.Fatalf("files %v", files)
	}
	if zones, _ := body["zones"].([]any); len(zones) != 1 {
		t.Fatalf("zones %v", body["zones"])
	}

	// the take route: a listed file is served (range-capable).
	req := httptest.NewRequest(http.MethodGet, "/api/matches/abc/ambience/ambience_00000001.ogg", nil)
	req.Header.Set("Range", "bytes=0-3")
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "OggS" || rec.Header().Get("Content-Type") != "audio/ogg" {
		t.Fatalf("take: %d %q %s", rec.Code, rec.Body.String(), rec.Header().Get("Content-Type"))
	}

	// an unlisted file 404s.
	if rec := get(t, h, "/api/matches/abc/ambience/ambience_00000002.ogg", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "ambience_not_built") {
		t.Fatalf("unlisted take: %d %s", rec.Code, rec.Body.String())
	}
	// a traversal 404s.
	if rec := get(t, h, "/api/matches/abc/ambience/..%2F..%2Fsecret.ogg", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("traversal: %d %s", rec.Code, rec.Body.String())
	}
	// a map without a bed 404s.
	if rec := get(t, h, "/api/matches/def/ambience.json", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "ambience_not_built") {
		t.Fatalf("not built: %d %s", rec.Code, rec.Body.String())
	}
	// an unknown match 404s.
	if rec := get(t, h, "/api/matches/fff/ambience.json", nil); rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "match_not_found") {
		t.Fatalf("unknown match: %d %s", rec.Code, rec.Body.String())
	}
}
