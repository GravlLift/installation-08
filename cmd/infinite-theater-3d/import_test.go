package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestParseImportFlagsRequired — the chunks folder is required; the map name is optional
// (resolved from the film when absent), and the other inputs (manifest, stats, match,
// catalog, data) parse to their zero form when absent.
func TestParseImportFlagsRequired(t *testing.T) {
	if _, err := parseImportFlags([]string{"--map", "Live Fire"}); err == nil {
		t.Error("no --chunks: expected an error")
	}
	f, err := parseImportFlags([]string{"--chunks", "d", "--map", "Live Fire"})
	if err != nil {
		t.Fatalf("minimal set: %v", err)
	}
	if f.mapName != "Live Fire" {
		t.Fatalf("map name = %q, want Live Fire", f.mapName)
	}
	if f.mvar != "" || f.manifest != "" || f.stats != "" || f.match != "" || f.catalog != "" || f.dataDir != "" {
		t.Fatalf("optional inputs not zero: %+v", f)
	}
	// The map name may be absent: it is then resolved from the film.
	f, err = parseImportFlags([]string{"--chunks", "d"})
	if err != nil {
		t.Fatalf("chunks only: %v", err)
	}
	if f.mapName != "" {
		t.Fatalf("absent map name = %q, want empty", f.mapName)
	}
}

// TestResolveImportMatchID — the import match-id rule: --match wins, then the manifest
// file name, then the chunks folder name; only the short8 form is expanded.
func TestResolveImportMatchID(t *testing.T) {
	const expanded = "7d798138-0000-0000-0000-000000000000"
	cases := []struct {
		name string
		f    importFlags
		want string
	}{
		{"flag wins", importFlags{match: "abc", manifest: "/m/7d798138.json", chunks: "/c/other"}, "abc"},
		{"manifest short8", importFlags{manifest: "/m/7d798138.json", chunks: "/c/other"}, expanded},
		{"chunks short8", importFlags{chunks: "/c/7d798138"}, expanded},
		{"non-hex stays empty", importFlags{chunks: "/c/whatever"}, ""},
		{"nothing", importFlags{}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := resolveImportMatchID(tc.f); got != tc.want {
				t.Fatalf("resolveImportMatchID = %q, want %q", got, tc.want)
			}
		})
	}
}

// TestDataDirFor — the data directory resolution: --data wins, then IT3D_DATA_DIR, then
// the repo checkout's data folder (a worktree shares the main checkout's), then the
// default under LOCALAPPDATA.
func TestDataDirFor(t *testing.T) {
	if got, err := dataDirFor("explicit"); err != nil || got != "explicit" {
		t.Fatalf("flag: %q, %v", got, err)
	}
	t.Setenv("IT3D_DATA_DIR", "fromenv")
	if got, err := dataDirFor(""); err != nil || got != "fromenv" {
		t.Fatalf("env: %q, %v", got, err)
	}
	t.Setenv("IT3D_DATA_DIR", "")

	repo := t.TempDir()
	mod := []byte("module " + modulePath + "\n\ngo 1.26\n")
	worktree := filepath.Join(repo, ".worktrees", "w")
	for _, dir := range []string{repo, worktree} {
		if err := os.MkdirAll(filepath.Join(dir, "cmd", "x"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(dir, "go.mod"), mod, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	for _, start := range []string{filepath.Join(repo, "cmd", "x"), filepath.Join(worktree, "cmd", "x")} {
		if got, err := dataDirFrom("", []string{start}); err != nil || got != filepath.Join(repo, "data") {
			t.Fatalf("checkout from %s: %q, %v", start, got, err)
		}
	}

	// Outside any checkout, the default is under LOCALAPPDATA.
	t.Setenv("LOCALAPPDATA", "C:/Users/x/AppData/Local")
	got, err := dataDirFrom("", []string{t.TempDir()})
	if err != nil {
		t.Fatalf("default: %v", err)
	}
	if got != filepath.Join("C:/Users/x/AppData/Local", "infinite-theater-3d", "data") {
		t.Fatalf("default = %q, want %q", got, filepath.Join("C:/Users/x/AppData/Local", "infinite-theater-3d", "data"))
	}
}

func TestImportVariantFlag(t *testing.T) {
	f, err := parseImportFlags([]string{"--chunks", "chunks", "--mvar", "map.mvar"})
	if err != nil || f.mvar != "map.mvar" {
		t.Fatalf("variant flag: %+v %v", f, err)
	}
}
