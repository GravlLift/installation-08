// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package endmatchvoice

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
)

// TestBuildWithoutTheGame — an install without any announcer package is not an error: every
// candidate is missing, the manifest is written and current.
func TestBuildWithoutTheGame(t *testing.T) {
	out := t.TempDir()
	res, err := Build(context.Background(), Options{GameRoot: t.TempDir(), OutDir: out})
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 0 || len(res.Missing) != len(Candidates) {
		t.Fatalf("files %d missing %v", res.Files, res.Missing)
	}
	if built, stale := ManifestStatus(out); !built || stale {
		t.Fatalf("built %v stale %v", built, stale)
	}
}

// TestManifestStatus — absent and unreadable manifests are not built; an older version is stale.
func TestManifestStatus(t *testing.T) {
	dir := t.TempDir()
	if built, _ := ManifestStatus(dir); built {
		t.Fatal("built without a manifest")
	}
	write := func(body string) {
		if err := os.WriteFile(filepath.Join(dir, ManifestName), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("{")
	if built, _ := ManifestStatus(dir); built {
		t.Fatal("built from an unreadable manifest")
	}
	raw, _ := json.Marshal(map[string]any{"version": ManifestVersion - 1})
	write(string(raw))
	if built, stale := ManifestStatus(dir); !built || !stale {
		t.Fatalf("older version: built %v stale %v", built, stale)
	}
}

// TestClosestTake — the take within tolerance and closest to the target wins; none within
// tolerance is reported as not found, never the nearest-anyway take.
func TestClosestTake(t *testing.T) {
	takes := []announcer.ManifestTake{{File: "a", DurationMs: 3349}, {File: "b", DurationMs: 1088}}
	got, ok := closestTake(takes, 1094, 15)
	if !ok || got.File != "b" {
		t.Fatalf("got %+v ok=%v", got, ok)
	}
	if _, ok := closestTake(takes, 1094, 5); ok {
		t.Fatal("matched outside tolerance")
	}
}

// TestCandidatesAreWellFormed — every candidate names a bare, unique stem and a vocalization.
func TestCandidatesAreWellFormed(t *testing.T) {
	seen := map[string]bool{}
	for _, c := range Candidates {
		if c.Stem == "" || filepath.Base(c.Stem) != c.Stem || seen[c.Stem] {
			t.Errorf("bad stem %+v", c)
		}
		seen[c.Stem] = true
		if c.Vocalization == "" || c.TargetMs <= 0 || c.ToleranceMs <= 0 {
			t.Errorf("bad candidate %+v", c)
		}
	}
}
