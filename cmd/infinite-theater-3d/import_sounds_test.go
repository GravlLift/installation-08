package main

// import_sounds_test.go — the `import-sounds` subcommand: it copies the .ogg
// set from the folder the user points at into the data directory, keeping
// any subfolder structure, skipping files already present and identical (a
// re-run copies nothing), replacing a changed file, and leaving non-ogg
// files behind.

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// soundsSourceFixture writes a small sound set: two .ogg files (one in a
// subfolder) and a non-sound file.
func soundsSourceFixture(t *testing.T, srcDir string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Join(srcDir, "weapons"), 0o750); err != nil {
		t.Fatal(err)
	}
	for name, content := range map[string]string{
		"gunshot_battle_rifle.ogg":                   "a",
		filepath.Join("weapons", "gunshot_ma40.ogg"): "b",
		"notes.txt": "not a sound",
	} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(srcDir, name)), 0o750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(srcDir, name), []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

// newTestRoot builds a store in a fresh temp data directory.
func newTestRoot(t *testing.T) *store.Root {
	t.Helper()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return root
}

// TestCopySounds — the copy itself: counts, subfolder kept, non-ogg left
// behind, a re-run skips everything, a changed file replaces.
func TestCopySounds(t *testing.T) {
	root := newTestRoot(t)
	src := t.TempDir()
	dst := t.TempDir()
	soundsSourceFixture(t, src)

	copied, skipped, err := copySounds(root, src, dst)
	if err != nil {
		t.Fatal(err)
	}
	if copied != 2 || skipped != 0 {
		t.Fatalf("first run: copied = %d, skipped = %d, want 2, 0", copied, skipped)
	}
	for path, want := range map[string]string{
		filepath.Join(dst, "gunshot_battle_rifle.ogg"):    "a",
		filepath.Join(dst, "weapons", "gunshot_ma40.ogg"): "b",
	} {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		if string(raw) != want {
			t.Fatalf("%s = %q, want %q", path, raw, want)
		}
	}
	if _, err := os.Stat(filepath.Join(dst, "notes.txt")); !os.IsNotExist(err) {
		t.Fatalf("notes.txt was copied, want it left behind (err = %v)", err)
	}

	copied, skipped, err = copySounds(root, src, dst)
	if err != nil {
		t.Fatal(err)
	}
	if copied != 0 || skipped != 2 {
		t.Fatalf("re-run: copied = %d, skipped = %d, want 0, 2", copied, skipped)
	}

	if err := os.WriteFile(filepath.Join(src, "gunshot_battle_rifle.ogg"), []byte("a2"), 0o600); err != nil {
		t.Fatal(err)
	}
	copied, skipped, err = copySounds(root, src, dst)
	if err != nil {
		t.Fatal(err)
	}
	if copied != 1 || skipped != 1 {
		t.Fatalf("changed file: copied = %d, skipped = %d, want 1, 1", copied, skipped)
	}
	raw, err := os.ReadFile(filepath.Join(dst, "gunshot_battle_rifle.ogg"))
	if err != nil || string(raw) != "a2" {
		t.Fatalf("replaced file = %q (err = %v), want a2", raw, err)
	}
}

// TestRunImportSounds — the subcommand end to end: --from and --data, the
// set lands in the data directory, a second run is a clean no-op, and a
// missing --from is an error.
func TestRunImportSounds(t *testing.T) {
	src := t.TempDir()
	data := t.TempDir()
	soundsSourceFixture(t, src)

	if err := runImportSounds([]string{"--from", src, "--data", data}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"gunshot_battle_rifle.ogg", filepath.Join("weapons", "gunshot_ma40.ogg")} {
		path := filepath.Join(soundsDir(data), name)
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("imported %s: %v", path, err)
		}
	}
	if err := runImportSounds([]string{"--from", src, "--data", data}); err != nil {
		t.Fatalf("re-run: %v", err)
	}
	if err := runImportSounds([]string{"--data", data}); err == nil {
		t.Fatal("missing --from: want an error, got nil")
	}
}
