package weaponicons

import (
	"os"
	"path/filepath"
	"testing"
)

// TestWeaponKeyContourFile — the weapon key -> contour file map read from a built
// index.json: only the contour-style entries with a key count, a missing set is an
// error (the caller falls back to no icon).
func TestWeaponKeyContourFile(t *testing.T) {
	dataDir := t.TempDir()
	if _, err := WeaponKeyContourFile(dataDir); err == nil {
		t.Fatal("missing index.json: want an error, got nil")
	}
	dir := OutDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`[
		{"index":0,"style":"contour","file":"contour-00.png","arme":"hinf_br75","source_tag":"bc17adf1"},
		{"index":0,"style":"silhouette","file":"silhouette-00.png","arme":"hinf_br75","source_tag":"e39747c8"},
		{"index":0,"style":"killfeed","file":"killfeed-00.png","source_tag":"00000000"}
	]`)
	if err := os.WriteFile(filepath.Join(dir, "index.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := WeaponKeyContourFile(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 1 || m["hinf_br75"] != "contour-00.png" {
		t.Fatalf("map = %v, want one contour entry", m)
	}
}
