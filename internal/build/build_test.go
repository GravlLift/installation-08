// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package build

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestBuildMissingMapName — no map is named and the film is absent: a clear error that
// says to pass --map (the name is then unresolvable, and there is no chunk_00 to read the
// asset id from), with or without an explicit catalog.
func TestBuildMissingMapName(t *testing.T) {
	_, _, err := Build(context.Background(), Input{ChunkDir: t.TempDir()})
	if err == nil {
		t.Fatal("expected an error without a map name (embedded catalog), got none")
	}
	if !strings.Contains(err.Error(), "pass --map") {
		t.Fatalf("error should say to pass --map: %v", err)
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

// TestBuildUnreadableChunks — the embedded catalog resolves the map (so no film read is
// needed to name it), but the chunk folder is not a film: the error is the named
// ErrUnreadable, wrapped with the folder, never a panic. The map name is one the embedded
// catalog carries ("Live Fire" = the acceptance film's map).
func TestBuildUnreadableChunks(t *testing.T) {
	dir := t.TempDir()
	_, report, err := Build(context.Background(), Input{
		ChunkDir: filepath.Join(dir, "no-film-here"),
		MapName:  "Live Fire",
	})
	if err == nil {
		t.Fatal("expected an error for an unreadable chunk folder, got none")
	}
	if !strings.Contains(err.Error(), "unreadable") {
		t.Fatalf("error should name the unreadable chunks: %v", err)
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
