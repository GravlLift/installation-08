// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package backdrop

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// TestOutDir — the folder is <dataDir>/assets/backdrop.
func TestOutDir(t *testing.T) {
	want := filepath.Join("data", "assets", "backdrop")
	if got := OutDir("data"); got != want {
		t.Fatalf("OutDir = %q, want %q", got, want)
	}
}

// TestSetReady — the file on disk is ready; an absent folder or a missing file is not.
func TestSetReady(t *testing.T) {
	dataDir := t.TempDir()
	if SetReady(dataDir) {
		t.Fatal("SetReady(empty) = true")
	}
	dir := OutDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if SetReady(dataDir) {
		t.Fatal("SetReady(folder only) = true")
	}
	if err := os.WriteFile(filepath.Join(dir, fileName), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !SetReady(dataDir) {
		t.Fatal("SetReady(file present) = false")
	}
}

// TestBuildRealExtraction — the real extraction, against an installed game, only when the
// gate is set. A normal test pass skips it (no gate). It writes to the passed data dir,
// never the repo's data dir.
func TestBuildRealExtraction(t *testing.T) {
	if os.Getenv("IT3D_BACKDROP_GAME") == "" {
		t.Skip("IT3D_BACKDROP_GAME not set: no real extraction in a normal test pass")
	}
	dataDir := os.Getenv("IT3D_BACKDROP_OUT")
	if dataDir == "" {
		t.Fatal("IT3D_BACKDROP_OUT not set")
	}
	gameRoot := os.Getenv(himap.DeployRootEnv) // empty -> auto-detect
	files, n, err := Build(context.Background(), gameRoot, dataDir)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if files != 1 || n <= 0 {
		t.Fatalf("Build reported files=%d bytes=%d, want 1 file with bytes>0", files, n)
	}
	if !SetReady(dataDir) {
		t.Fatal("SetReady after Build = false")
	}
}
