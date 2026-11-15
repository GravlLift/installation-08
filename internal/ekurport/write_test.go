package ekurport

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// TestWriteExportRefusesNonEmptyDir checks that WriteExport refuses a target dir that is
// not empty, before it touches the game.
func TestWriteExportRefusesNonEmptyDir(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "junk.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("seed dir: %v", err)
	}
	if _, err := WriteExport(context.Background(), "", dir); err == nil {
		t.Fatal("expected WriteExport to refuse a non-empty dir")
	}
}
