//go:build gamefiles

package reloadsounds

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/firstperson"
)

// TestBuildFromTheInstalledGame extracts the reloads of the installed game: the magazine weapons
// have one, the battery weapons (they vent) and the melee weapons have none, and every take the
// manifest lists is an Ogg file.
func TestBuildFromTheInstalledGame(t *testing.T) {
	ctx := context.Background()
	root, module, err := firstperson.ResolveModule(ctx, firstperson.Options{})
	if err != nil {
		t.Skipf("no installed game: %v", err)
	}
	dir := t.TempDir()
	res, err := Build(ctx, Options{GameRoot: root, Module: module, OutDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	for _, w := range []string{"2b1824d5", "6acdc44d", "0a1992bc", "48c19d2d", "f408190f"} { // BR75, bandit, S7, MA40, sidekick
		r, ok := res.Manifest.Weapons[w]["combat"]
		if !ok || len(r.Sounds) == 0 || r.DurationMs <= 0 {
			t.Errorf("%s: no standing reload (%+v)", w, r)
		}
	}
	for _, w := range []string{"c3542946", "30484ea6", "c30d87c7", "daf193c7", "4ff3937e"} { // plasma pistol, pulse carbine, ravager, stalker, sword
		if _, ok := res.Manifest.Weapons[w]; ok {
			t.Errorf("%s has a reload", w)
		}
		if !slices.Contains(res.Silent[SilentNoAnimation], w) {
			t.Errorf("%s is not silent for want of a reload animation", w)
		}
	}
	for w, stances := range res.Manifest.Weapons {
		for _, r := range stances {
			for _, s := range r.Sounds {
				for _, tk := range s.Takes {
					raw, err := os.ReadFile(filepath.Join(dir, tk.File))
					if err != nil || !bytes.HasPrefix(raw, []byte("OggS")) || tk.DurationMs <= 0 {
						t.Errorf("%s: take %s (%d ms): %v", w, tk.File, tk.DurationMs, err)
					}
				}
			}
		}
	}
}
