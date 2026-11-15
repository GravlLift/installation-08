package weapons

import (
	"os"
	"path/filepath"
	"testing"
)

// TestFirstInstalledMap: a fresh install names no map, so the roster opens the first map
// folder whose module is present; folders without a module are skipped.
func TestFirstInstalledMap(t *testing.T) {
	root := t.TempDir()
	multi := filepath.Join(root, "pc", "levels", "multi")
	for _, name := range []string{"a_empty", "b_map", "c_map"} {
		if err := os.MkdirAll(filepath.Join(multi, name), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, name := range []string{"b_map", "c_map"} {
		if err := os.WriteFile(filepath.Join(multi, name, name+"-rtx-new.module"), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if got, ok := firstInstalledMap(root); !ok || got != "b_map" {
		t.Fatalf("firstInstalledMap = %q, %v; want b_map", got, ok)
	}
	if _, ok := firstInstalledMap(t.TempDir()); ok {
		t.Fatal("an empty game root found a map")
	}
}
