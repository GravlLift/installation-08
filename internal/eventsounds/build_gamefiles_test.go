// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package eventsounds

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestBuildFromTheInstalledGame extracts every event sound of the installed game: nothing is
// missing, every take is a real Ogg file, and each has the measured duration this package's
// table was confirmed against (within the repack's own rounding).
func TestBuildFromTheInstalledGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skipf("no installed game: %v", err)
	}
	dir := t.TempDir()
	res, err := Build(context.Background(), Options{GameRoot: root, OutDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Missing) != 0 {
		t.Fatalf("missing %v", res.Missing)
	}
	for stem, take := range res.Manifest.Sounds {
		raw, err := os.ReadFile(filepath.Join(dir, take.File))
		if err != nil || !bytes.HasPrefix(raw, []byte("OggS")) || take.DurationMs <= 0 {
			t.Errorf("%s: %+v is not an Ogg file (%v)", stem, take, err)
		}
	}
	within := func(stem string, lo, hi int) {
		take, ok := res.Manifest.Sounds[stem]
		if !ok {
			t.Errorf("%s: not extracted", stem)
			return
		}
		if take.DurationMs < lo || take.DurationMs > hi {
			t.Errorf("%s: %d ms, want %d..%d", stem, take.DurationMs, lo, hi)
		}
	}
	// Measured against the installed game (see build.go's table comments) and, for every stem
	// below, within a few ms of the embedded file it replaces.
	within("repair_field_activate", 3750, 4050)
	within("repair_field_activate_v2", 3100, 3450)
	within("repair_field_activate_v3", 2650, 2950)
	within("repair_field_end", 1700, 1950)
	within("repair_field_end_v2", 1700, 1950)
	within("repair_field_end_v3", 1700, 1950)
	within("weapon_drop", 250, 450)
	within("weapon_pickup", 250, 450)
	within("objective_pad_spawn", 1300, 1500)
	within("equipment_pad_spawn", 450, 650)
	within("objective_bomb_detonated", 4300, 4500)
	within("objective_skull_spawn", 5350, 5600)
	within("objective_skull_despawn", 1650, 1900)
	within("objective_skull_taken", 2600, 2950)
	within("objective_skull_pickup", 2150, 2400)
	within("objective_skull_dropped", 2800, 3100)
	within("objective_zone_captured_team", 2750, 3050)
	within("objective_zone_captured_enemy", 2200, 2450)
	within("objective_zone_contested", 1050, 1300)
	// The equipment family: each shipped file's own length, within a few ms.
	within("camo_deactivate", 1880, 1930)
	within("shroud_deploy", 1810, 1860)
	within("grapple_fire", 730, 760)
	within("grapple_fire_v2", 750, 780)
	within("grapple_fire_v3", 740, 770)
	within("repulsor_kill", 1520, 1550)
	within("repulsor_kill_v2", 1430, 1460)
	within("repulsor_kill_v3", 1580, 1610)
	within("objective_pad_pickup", 790, 820)
}
