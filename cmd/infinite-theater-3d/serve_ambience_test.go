package main

import (
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
