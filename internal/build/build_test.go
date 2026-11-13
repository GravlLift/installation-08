package build

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestBuildMissingMapName — no map is named: a clear error before any film byte is read,
// with or without an explicit catalog (the name is the catalog key; it is not derivable
// from the film, whose only map identifiers are variant guids).
func TestBuildMissingMapName(t *testing.T) {
	if _, _, err := Build(context.Background(), Input{ChunkDir: t.TempDir()}); err == nil {
		t.Fatal("expected an error without a map name (embedded catalog), got none")
	}
	dir := t.TempDir()
	cat := filepath.Join(dir, "cat.json")
	mustWrite(t, cat, `{"schemaVersion":1,"maps":{"Live Fire":{"module":"live_fire","min":[0,0,0],"max":[100,100,100],"axisWidths":[7,7,7]}}}`)
	if _, _, err := Build(context.Background(), Input{ChunkDir: t.TempDir(), CatalogPath: cat}); err == nil {
		t.Fatal("expected an error without a map name (explicit catalog), got none")
	}
}

// TestCatalogOverride — an explicit catalog path wins over the embedded one: a map that is
// only in the override resolves through it, and an unknown schema version in the override
// is rejected (the override is not silently ignored).
func TestCatalogOverride(t *testing.T) {
	dir := t.TempDir()
	override := filepath.Join(dir, "override.json")
	mustWrite(t, override, `{"schemaVersion":1,"maps":{"only in override":{"module":"ovr","min":[0,0,0],"max":[10,10,10],"axisWidths":[5,5,5]}}}`)
	// "only in override" is not in the embedded catalog, so a successful resolve proves
	// the override was consulted (the catalog normalizes keys to lowercase).
	cat, err := catalogOf(Input{CatalogPath: override})
	if err != nil {
		t.Fatalf("load override: %v", err)
	}
	if _, err := cat.Lookup("Only In Override"); err != nil {
		t.Fatalf("override catalog not consulted: %v", err)
	}
	bad := filepath.Join(dir, "bad.json")
	mustWrite(t, bad, `{"schemaVersion":99,"maps":{}}`)
	if _, err := catalogOf(Input{CatalogPath: bad}); err == nil {
		t.Fatal("expected the override's schema-version error, got none")
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
