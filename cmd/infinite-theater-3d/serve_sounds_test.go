package main

// serve_sounds_test.go — the replay sound route. The route serves a file from the data
// directory when the user has one there (an imported file wins), otherwise from the
// built-in embedded set: the file is served with audio/ogg and its exact bytes. A name in
// neither set, a name that is not an .ogg, and a name that would escape the set's folder
// are a 404. A request never imports or enqueues anything.

import (
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/sounds"
)

const soundRoute = "/static/sounds/halo_infinite/"

// soundFixture writes a small sound set into the data directory: one file that the
// embedded set also holds (so the "imported wins" case is observable) and one the
// embedded set does not hold (so the data-directory-only case is observable).
func soundFixture(t *testing.T, dataDir string) {
	t.Helper()
	dir := soundsDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	for name, body := range map[string]string{
		"gunshot_battle_rifle.ogg": "imported:gunshot_battle_rifle.ogg",
		"user_only_sound.ogg":      "imported:user_only_sound.ogg",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// embeddedSoundName is one sound file of the built-in set, chosen by listing it: the
// test does not depend on any particular name beyond the set being non-empty.
func embeddedSoundName(t *testing.T) string {
	t.Helper()
	entries, err := fs.ReadDir(sounds.Open(), ".")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range entries {
		if !e.IsDir() {
			return e.Name()
		}
	}
	t.Fatal("embedded sound set is empty")
	return ""
}

// embeddedSoundBytes reads one file of the built-in set: the bytes the route must serve.
func embeddedSoundBytes(t *testing.T, name string) []byte {
	t.Helper()
	f, err := sounds.Open().Open(name)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	b, err := io.ReadAll(f)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// TestSoundRouteServesOgg — a file the user imported is served with audio/ogg and its
// bytes: the data-directory copy wins even when the embedded set holds the same name.
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
	if body := rec.Body.String(); body != "imported:gunshot_battle_rifle.ogg" {
		t.Fatalf("body = %q, want the data-directory bytes (the import wins)", body)
	}
}

// TestSoundRouteEmbeddedFallback — with no import at all, a file of the built-in set is
// served with audio/ogg and its exact bytes.
func TestSoundRouteEmbeddedFallback(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)
	name := embeddedSoundName(t)
	want := embeddedSoundBytes(t, name)

	rec := get(t, h, soundRoute+name, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if rec.Header().Get("Content-Type") != "audio/ogg" {
		t.Fatalf("Content-Type = %q, want audio/ogg", rec.Header().Get("Content-Type"))
	}
	if got := rec.Body.String(); got != string(want) {
		t.Fatalf("body = %d bytes, want the embedded file's %d bytes", len(got), len(want))
	}
}

// TestSoundRouteUnknownName — a name in neither the data directory nor the embedded set
// is a 404, and so is a name that is not an .ogg.
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

// TestSoundRouteDataDirectoryOnly — a file the user imported that the embedded set does
// not hold is served from the data directory.
func TestSoundRouteDataDirectoryOnly(t *testing.T) {
	root := newFakeStore(t)
	soundFixture(t, root.Dir())
	h := newTestHandlers(root, nil)

	rec := get(t, h, soundRoute+"user_only_sound.ogg", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body := rec.Body.String(); body != "imported:user_only_sound.ogg" {
		t.Fatalf("body = %q", body)
	}
}

// TestSoundRouteTraversal — a name that would escape the set's folder is a 404
// (joinInside refuses it before the embedded set is even asked).
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
	req := httptest.NewRequest(http.MethodGet, soundRoute+"user_only_sound.ogg", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if rec.Header().Get("Content-Type") != "audio/ogg" {
		t.Fatalf("Content-Type = %q", rec.Header().Get("Content-Type"))
	}
}

// TestSoundFile — the name filter: an .ogg and the announcer manifest pass, anything else does not.
func TestSoundFile(t *testing.T) {
	cases := map[string]bool{
		"gunshot_battle_rifle.ogg": true,
		"a.ogg":                    true,
		"a.OGG":                    false,
		"a.oggx":                   false,
		"a":                        false,
		"index.json":               false,
		"announcer.json":           true,
		"announcer.JSON":           false,
	}
	for name, want := range cases {
		if ok := soundFile(name); ok != want {
			t.Errorf("soundFile(%q) = %v, want %v", name, ok, want)
		}
	}
}

// TestSoundRouteAnnouncerManifest — the manifest build-sounds writes is served as JSON from
// the data directory; without an extraction it is a 404 (the built-in set has none), which
// the viewer reads as "no announcer lines".
func TestSoundRouteAnnouncerManifest(t *testing.T) {
	root := newFakeStore(t)
	h := newTestHandlers(root, nil)
	if rec := get(t, h, soundRoute+"announcer.json", nil); rec.Code != http.StatusNotFound {
		t.Fatalf("no extraction: status = %d, want 404", rec.Code)
	}
	soundFixture(t, root.Dir())
	if err := os.WriteFile(filepath.Join(soundsDir(root.Dir()), "announcer.json"), []byte(`{"version":1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	rec := get(t, h, soundRoute+"announcer.json", nil)
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "application/json" || rec.Body.String() != `{"version":1}` {
		t.Fatalf("status = %d, Content-Type = %q, body = %q", rec.Code, rec.Header().Get("Content-Type"), rec.Body.String())
	}
}
