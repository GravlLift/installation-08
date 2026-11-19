// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

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

// TestBuildFromTheInstalledGame extracts the beds of a Forge map and two native maps of the
// installed game: each fallback is one quad Ogg loop of tens of seconds, the one of the zone
// with the largest volume. The native map also carries its other loops and zone shapes.
func TestBuildFromTheInstalledGame(t *testing.T) {
	root, err := himap.DeployRoot()
	if err != nil {
		t.Skipf("no installed game: %v", err)
	}
	dir := t.TempDir()
	res, err := Build(context.Background(), Options{GameRoot: root, OutDir: dir, Maps: []string{"fo09_academy", "sgh_streets", "sgh_interlock"}})
	if err != nil {
		t.Fatal(err)
	}
	for key, loop := range map[string]string{"fo09_academy": "5d6cc1cb", "sgh_streets": "780acd33", "sgh_interlock": "140d82b9"} {
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
	// sgh_interlock carries more than one extracted loop and non-empty zone shapes.
	bed := res.Manifest.Maps["sgh_interlock"]
	if len(bed.Loops) <= 1 {
		t.Fatalf("sgh_interlock: %d loops, want more than 1", len(bed.Loops))
	}
	if len(bed.Shapes) == 0 {
		t.Fatal("sgh_interlock: no zone shapes")
	}
	for _, s := range bed.Shapes {
		if len(s.Points) < 3 {
			t.Errorf("sgh_interlock: zone %d has %d points, want >= 3", s.Zone, len(s.Points))
		}
	}
}
