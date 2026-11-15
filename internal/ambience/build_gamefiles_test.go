//go:build gamefiles

package ambience

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestBuildFromTheInstalledGame extracts the beds of a Forge map and a native map of the
// installed game: each is one quad Ogg loop of tens of seconds, the one the palette names most.
func TestBuildFromTheInstalledGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skipf("no installed game: %v", err)
	}
	dir := t.TempDir()
	res, err := Build(context.Background(), Options{GameRoot: root, OutDir: dir, Maps: []string{"fo09_academy", "sgh_streets"}})
	if err != nil {
		t.Fatal(err)
	}
	for key, loop := range map[string]string{"fo09_academy": "5d6cc1cb", "sgh_streets": "730c3801"} {
		bed, ok := res.Manifest.Maps[key]
		if !ok || bed.Loop != loop || len(bed.Takes) != 1 {
			t.Fatalf("%s: bed %+v, want loop %s with one take (skipped %v)", key, bed, loop, res.Skipped)
		}
		tk := bed.Takes[0]
		raw, err := os.ReadFile(filepath.Join(dir, tk.File))
		if err != nil || !bytes.HasPrefix(raw, []byte("OggS")) || tk.Channels != 4 || tk.DurationMs < 10_000 {
			t.Errorf("%s: take %+v: %v", key, tk, err)
		}
	}
}
