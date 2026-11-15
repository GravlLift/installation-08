package uisounds

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// TestBuildWithoutTheBank — an install without the interface bank is not an error: the manifest
// is written, current, with every sound missing (the viewer stays silent on them).
func TestBuildWithoutTheBank(t *testing.T) {
	out := t.TempDir()
	res, err := Build(context.Background(), Options{DeployRoot: t.TempDir(), OutDir: out})
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

// TestStemsAreServable — every stem names an .ogg file the sound route serves (a bare file name),
// once: two sounds on one stem would overwrite each other's file.
func TestStemsAreServable(t *testing.T) {
	seen := map[string]bool{}
	for _, s := range Sounds {
		if s.Stem == "" || filepath.Base(s.Stem) != s.Stem || s.Event == "" || seen[s.Stem] {
			t.Errorf("bad sound %+v", s)
		}
		seen[s.Stem] = true
	}
}

// TestSoundsDefaultToTheInterfaceBank — a sound without a bank is in the interface bank.
func TestSoundsDefaultToTheInterfaceBank(t *testing.T) {
	if (Sound{}).bankOf() != BankName || (Sound{Bank: SpartanBank}).bankOf() != SpartanBank {
		t.Fatal("bankOf")
	}
}
