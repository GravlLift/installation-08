// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package eventsounds

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestBuildWithoutTheGame — an install without any of the wanted banks is not an error: the
// manifest is written, current, with every sound missing (the viewer falls back to the embedded
// file).
func TestBuildWithoutTheGame(t *testing.T) {
	out := t.TempDir()
	res, err := Build(context.Background(), Options{GameRoot: t.TempDir(), OutDir: out})
	if err != nil {
		t.Fatal(err)
	}
	if res.Files != 0 || len(res.Missing) != len(Sounds) {
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

// TestSoundsAreWellFormed — every sound names exactly one bank source, a bare stem (servable as
// a file name), and a stem used once: a second sound on the same stem, or a variant count that
// would collide with another stem's own _v2/_v3 file, would silently overwrite a file.
func TestSoundsAreWellFormed(t *testing.T) {
	seen := map[string]bool{}
	for _, s := range Sounds {
		if s.Stem == "" || filepath.Base(s.Stem) != s.Stem {
			t.Errorf("bad stem %+v", s)
		}
		if (s.Tag == 0) == (s.Name == "") {
			t.Errorf("%s: want exactly one of Tag, Name", s.Stem)
		}
		if s.Event == 0 {
			t.Errorf("%s: no event", s.Stem)
		}
		n := s.Variants
		if n < 1 {
			n = 1
		}
		for i := 0; i < n; i++ {
			stem := s.Stem
			if i > 0 {
				stem = s.Stem + "_v" + string(rune('0'+i+1))
			}
			if seen[stem] {
				t.Errorf("stem %q used twice", stem)
			}
			seen[stem] = true
		}
	}
}

// TestFilterMedia — the helper picks the wanted id when present and reports nothing (not the
// whole list) when it is absent: a caller must never fall back to an unrelated media.
func TestFilterMedia(t *testing.T) {
	if got := filterMedia([]uint32{1, 2, 3}, 2); len(got) != 1 || got[0] != 2 {
		t.Fatalf("got %v", got)
	}
	if got := filterMedia([]uint32{1, 2, 3}, 9); got != nil {
		t.Fatalf("got %v, want nil", got)
	}
}
