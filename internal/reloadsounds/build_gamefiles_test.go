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
	ventKeys := make([]string, 0, len(res.Manifest.Vents))
	for w := range res.Manifest.Vents {
		ventKeys = append(ventKeys, w)
	}
	slices.Sort(ventKeys)
	t.Logf("vent entries: %v", ventKeys)
	for _, w := range ventKeys {
		if _, ok := res.Manifest.Weapons[w]; ok {
			t.Errorf("%s has both a reload and a vent", w)
		}
	}
	// The heat weapons vent: the standing vent of each has an enter and an exit with takes, and
	// a loop the game posts no sound on.
	for _, w := range []string{"daf193c7", "c3542946", "30484ea6", "c30d87c7"} { // stalker, plasma pistol, pulse carbine, ravager
		v, ok := res.Manifest.Vents[w]["combat"]
		if !ok {
			t.Errorf("%s: no standing vent (%+v)", w, res.Manifest.Vents[w])
			continue
		}
		if len(v.Enter.Sounds) == 0 || v.Enter.DurationMs <= 0 {
			t.Errorf("%s: vent enter has no sound (%+v)", w, v.Enter)
		}
		if len(v.Exit.Sounds) == 0 || v.Exit.DurationMs <= 0 {
			t.Errorf("%s: vent exit has no sound (%+v)", w, v.Exit)
		}
		if len(v.Loop.Sounds) != 0 {
			t.Errorf("%s: vent loop posts sounds in the installed game (%d)", w, len(v.Loop.Sounds))
		}
	}
	takeOk := func(w, what string, tk Take) {
		raw, err := os.ReadFile(filepath.Join(dir, tk.File))
		if err != nil || !bytes.HasPrefix(raw, []byte("OggS")) || tk.DurationMs <= 0 {
			t.Errorf("%s: %s take %s (%d ms): %v", w, what, tk.File, tk.DurationMs, err)
		}
	}
	for w, stances := range res.Manifest.Weapons {
		for _, r := range stances {
			for _, s := range r.Sounds {
				for _, tk := range s.Takes {
					takeOk(w, "reload", tk)
				}
			}
		}
	}
	for w, stances := range res.Manifest.Vents {
		for _, v := range stances {
			for _, c := range []VentClip{v.Enter, v.Loop, v.Exit} {
				for _, s := range c.Sounds {
					for _, tk := range s.Takes {
						takeOk(w, "vent", tk)
					}
				}
			}
		}
	}
}
