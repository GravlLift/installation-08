package build

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestBuildMissingCatalog — a decode without a map catalog fails with a clear error before
// any film byte is read (the bounds are not derivable from the film).
func TestBuildMissingCatalog(t *testing.T) {
	_, _, err := Build(context.Background(), Input{ChunkDir: t.TempDir(), MapName: "Live Fire"})
	if err == nil {
		t.Fatal("expected an error without a catalog path, got none")
	}
}

// TestBuildMissingMapName — the catalog is present but the map is not named: clear error.
func TestBuildMissingMapName(t *testing.T) {
	dir := t.TempDir()
	cat := filepath.Join(dir, "cat.json")
	mustWrite(t, cat, `{"schemaVersion":1,"maps":{"Live Fire":{"module":"live_fire","min":[0,0,0],"max":[100,100,100],"axisWidths":[7,7,7]}}}`)
	_, _, err := Build(context.Background(), Input{ChunkDir: t.TempDir(), CatalogPath: cat})
	if err == nil {
		t.Fatal("expected an error without a map name, got none")
	}
}

// TestBuildUnreadableChunks — a catalog and a map name are given, but the chunk folder is
// not a film: the error is the named ErrUnreadable, wrapped with the folder, never a panic.
func TestBuildUnreadableChunks(t *testing.T) {
	dir := t.TempDir()
	cat := filepath.Join(dir, "cat.json")
	mustWrite(t, cat, `{"schemaVersion":1,"maps":{"Live Fire":{"module":"live_fire","min":[0,0,0],"max":[100,100,100],"axisWidths":[7,7,7]}}}`)
	_, report, err := Build(context.Background(), Input{
		ChunkDir:    filepath.Join(dir, "no-film-here"),
		CatalogPath: cat,
		MapName:     "Live Fire",
	})
	if err == nil {
		t.Fatal("expected an error for an unreadable chunk folder, got none")
	}
	if report.MatchID != "" {
		t.Fatalf("expected an empty match id on failure, got %q", report.MatchID)
	}
}

// mustWrite writes a file, failing the test on error.
func mustWrite(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
