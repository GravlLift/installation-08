package footstepsounds

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRemoveStaleTakesDeletesOnlyTakesTheManifestDoesNotList(t *testing.T) {
	dir := t.TempDir()
	m := &Manifest{
		Version: ManifestVersion,
		Feet:    map[string]map[string]Footstep{"default": {walk: {Takes: []Take{{File: "foot_00000001.ogg"}}}}},
		Movement: map[string]Footstep{land: {Takes: []Take{{File: "foot_00000002.ogg"}}}},
	}
	keep := []string{"foot_00000001.ogg", "foot_00000002.ogg"}
	stale := "foot_00000003.ogg"
	for _, name := range append(append([]string{}, keep...), stale) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// files that are not takes, and the manifest itself, are left alone
	for _, name := range []string{"reload_00000003.ogg", "footsteps.json"} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	removed, err := removeStaleTakes(dir, m)
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("removed %d, want 1", removed)
	}
	for _, name := range keep {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Errorf("%s is gone", name)
		}
	}
	if _, err := os.Stat(filepath.Join(dir, stale)); !os.IsNotExist(err) {
		t.Errorf("%s survived", stale)
	}
}

func TestManifestStatus(t *testing.T) {
	dir := t.TempDir()
	if built, stale := ManifestStatus(dir); built || stale {
		t.Fatalf("no manifest: built %v stale %v", built, stale)
	}
	write := func(version int) {
		m := &Manifest{Version: version}
		if err := writeManifest(dir, m); err != nil {
			t.Fatal(err)
		}
	}
	write(ManifestVersion)
	built, stale := ManifestStatus(dir)
	if !built || stale {
		t.Fatalf("built %v stale %v", built, stale)
	}
	write(ManifestVersion - 1)
	built, stale = ManifestStatus(dir)
	if !built || !stale {
		t.Fatalf("older version: built %v stale %v", built, stale)
	}
}
