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

// TestBuildFromTheInstalledGame extracts the interface sounds of the installed game: the
// countdown tick is there, as an Ogg file of a fraction of a second.
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
	tick, ok := res.Manifest.Sounds["ui_countdown_tick"]
	if !ok || tick.DurationMs <= 0 || tick.DurationMs > 3000 {
		t.Fatalf("countdown tick %+v", tick)
	}
	raw, err := os.ReadFile(filepath.Join(dir, tick.File))
	if err != nil || !bytes.HasPrefix(raw, []byte("OggS")) {
		t.Fatalf("%s is not an Ogg file (%v)", tick.File, err)
	}
	t.Logf("countdown tick: media %d, %d ms, %d bytes", tick.Media, tick.DurationMs, len(raw))
}
