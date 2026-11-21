// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

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
		,{"index":33,"style":"contour","file":"contour-33.png","arme":"hinf_bandit","tags_weap":["2fb21c87","6acdc44d"]}
	]`)
	if err := os.WriteFile(filepath.Join(dir, "index.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := WeaponKeyContourFile(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 3 || m["hinf_br75"] != "contour-00.png" || m["hinf_bandit"] != "contour-33.png" || m["hinf_bandit_evo"] != "contour-33.png" {
		t.Fatalf("map = %v, want both Bandits and BR75", m)
	}
}

// TestKillfeedFiles — the kill feed sprites of a built index.json, keyed by the stem the
// killicon bridge names (killfeed-NN); contour and silhouette entries are not listed,
// and a missing set is an error.
func TestKillfeedFiles(t *testing.T) {
	dataDir := t.TempDir()
	if _, err := KillfeedFiles(dataDir); err == nil {
		t.Fatal("missing index.json: want an error, got nil")
	}
	dir := OutDir(dataDir)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	raw := []byte(`[
		{"index":0,"style":"contour","file":"contour-00.png","arme":"hinf_br75"},
		{"index":0,"style":"killfeed","file":"killfeed-00.png","nom_jeu":"battle_rifle"},
		{"index":65,"style":"killfeed","file":"killfeed-65.png","nom_jeu":"melee"}
	]`)
	if err := os.WriteFile(filepath.Join(dir, "index.json"), raw, 0o600); err != nil {
		t.Fatal(err)
	}
	m, err := KillfeedFiles(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 2 || m["killfeed-00"] != "killfeed-00.png" || m["killfeed-65"] != "killfeed-65.png" {
		t.Fatalf("map = %v, want the two kill feed sprites", m)
	}
}
