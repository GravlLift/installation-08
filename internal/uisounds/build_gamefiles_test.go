//go:build gamefiles

package uisounds

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestBuildFromTheInstalledGame extracts the interface sounds of the installed game: every sound
// is there as an Ogg file, each named media is the one taken, the countdown tick lasts a fraction
// of a second and the shield loops their measured length.
func TestBuildFromTheInstalledGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skipf("no installed game: %v", err)
	}
	dir := t.TempDir()
	res, err := Build(context.Background(), Options{DeployRoot: root, OutDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Missing) != 0 {
		t.Fatalf("missing %v", res.Missing)
	}
	for _, s := range Sounds {
		take := res.Manifest.Sounds[s.Stem]
		if s.Media != 0 && take.Media != s.Media {
			t.Errorf("%s: media %d, want %d", s.Stem, take.Media, s.Media)
		}
		raw, err := os.ReadFile(filepath.Join(dir, take.File))
		if err != nil || !bytes.HasPrefix(raw, []byte("OggS")) || take.DurationMs <= 0 {
			t.Errorf("%s: %+v is not an Ogg file (%v)", s.Stem, take, err)
		}
		t.Logf("%s: media %d, %d ms, %d bytes", s.Stem, take.Media, take.DurationMs, len(raw))
	}
	within := func(stem string, lo, hi int) {
		if d := res.Manifest.Sounds[stem].DurationMs; d < lo || d > hi {
			t.Errorf("%s: %d ms, want %d..%d", stem, d, lo, hi)
		}
	}
	within("ui_countdown_tick", 1, 3000)
	within("shield_low_loop", 780, 870)        // 4 beeps
	within("shield_depleted_loop", 2250, 2350) // 12 beeps
	within("shield_break", 3200, 3300)
	within("shield_full", 1000, 1100)
}
