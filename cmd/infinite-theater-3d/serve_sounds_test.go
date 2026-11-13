package main

// serve_sounds_test.go — the replay sound route. The route serves the imported
// .ogg set only: an imported file is served as audio/ogg, a name the import
// did not write is a 404, a name that is not an .ogg is a 404, and a name
// that would escape the set's folder is a 404. A request never imports or
// enqueues anything.

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

const soundRoute = "/static/sounds/halo_infinite/"

// soundFixture writes a small sound set into the data directory.
func soundFixture(t *testing.T, dataDir string) {
	t.Helper()
	dir := soundsDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"gunshot_battle_rifle.ogg", "explosion_grenade.ogg"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("ogg:"+name), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// TestSoundRouteServesOgg — an imported file is served with audio/ogg and its
// bytes.
func TestSoundRouteServesOgg(t *testing.T) {
	root := newFakeStore(t)
	soundFixture(t, root.Dir())
	h := newTestHandlers(root, nil)

	rec := get(t, h, soundRoute+"gunshot_battle_rifle.ogg", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "audio/ogg" {
		t.Fatalf("Content-Type = %q, want audio/ogg", rec.Header().Get("Content-Type"))
	}
	if body := rec.Body.String(); body != "ogg:gunshot_battle_rifle.ogg" {
		t.Fatalf("body = %q", body)
	}
}

// TestSoundRouteUnknownName — a name the import did not write is a 404, and so
// is a name that is not an .ogg.
func TestSoundRouteUnknownName(t *testing.T) {
	root := newFakeStore(t)
	soundFixture(t, root.Dir())
	h := newTestHandlers(root, nil)
	for _, name := range []string{"nope.ogg", "gunshot.mp3", "index.json", "gunshot_battle_rifle.oggx"} {
		rec := get(t, h, soundRoute+name, nil)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s: status = %d, want 404", name, rec.Code)
		}
	}
}

// TestSoundRouteMissingSet — with no import at all the folder is absent and
// every request is a 404.
func TestSoundRouteMissingSet(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)
	rec := get(t, h, soundRoute+"gunshot_battle_rifle.ogg", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// TestSoundRouteTraversal — a name that would escape the set's folder is a
// 404 (joinInside refuses it).
func TestSoundRouteTraversal(t *testing.T) {
	root := newFakeStore(t)
	soundFixture(t, root.Dir())
	h := newTestHandlers(root, nil)
	rec := get(t, h, soundRoute+"..%2f..%2foutside.ogg", nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

// TestSoundRouteViaMux — the route is registered on the server's mux.
func TestSoundRouteViaMux(t *testing.T) {
	root := newFakeStore(t)
	soundFixture(t, root.Dir())
	h := newTestHandlers(root, nil)
	req := httptest.NewRequest(http.MethodGet, soundRoute+"explosion_grenade.ogg", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "audio/ogg" {
		t.Fatalf("Content-Type = %q", rec.Header().Get("Content-Type"))
	}
}

// TestSoundFile — the name filter: an .ogg passes, anything else does not.
func TestSoundFile(t *testing.T) {
	cases := map[string]bool{
		"gunshot_battle_rifle.ogg": true,
		"a.ogg":                    true,
		"a.OGG":                    false,
		"a.oggx":                   false,
		"a":                        false,
		"index.json":               false,
	}
	for name, want := range cases {
		if ok := soundFile(name); ok != want {
			t.Errorf("soundFile(%q) = %v, want %v", name, ok, want)
		}
	}
}

// TestSoundsPresent — the startup check: absent folder, a folder with no
// .ogg, and a folder with one .ogg.
func TestSoundsPresent(t *testing.T) {
	root := newFakeStore(t)
	if soundsPresent(root.Dir()) {
		t.Fatal("soundsPresent = true with no folder, want false")
	}
	dir := soundsDir(root.Dir())
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if soundsPresent(root.Dir()) {
		t.Fatal("soundsPresent = true with no .ogg, want false")
	}
	if err := os.WriteFile(filepath.Join(dir, "a.ogg"), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !soundsPresent(root.Dir()) {
		t.Fatal("soundsPresent = false with a .ogg, want true")
	}
}
