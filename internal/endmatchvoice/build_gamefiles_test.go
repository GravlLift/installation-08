// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

//go:build gamefiles

package endmatchvoice

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestBuildFromTheInstalledGame extracts end_defeat_voice_en_01 from the installed game: it is
// found, is a real Ogg file, and lands within the candidate's tolerance of its target duration.
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
	take, ok := res.Manifest.Sounds["end_defeat_voice_en_01"]
	if !ok {
		t.Fatalf("end_defeat_voice_en_01 missing: %v", res.Missing)
	}
	raw, err := os.ReadFile(filepath.Join(dir, take.File))
	if err != nil || !bytes.HasPrefix(raw, []byte("OggS")) {
		t.Fatalf("%+v is not an Ogg file (%v)", take, err)
	}
	if d := take.DurationMs - 1094; d < -15 || d > 15 {
		t.Errorf("duration %dms, want within 15ms of 1094", take.DurationMs)
	}
}
