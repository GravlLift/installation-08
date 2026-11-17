// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_jobs_ekur_test.go — the Ekur stamp wiring of the coating libraries: the readiness
// check (stamp match, mismatch, no-downgrade) and the stale rename/cleanup (a .stale folder
// is removed after a successful rebuild, a .stale containing a symlink is left in place).
// All fixtures are small synthetic temp folders; no game install, no network.

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// writeCoatingLibraryIndex lays down a library folder for module with an index.json
// carrying the given ekur_stamp and the module's current schema (a current build writes it).
func writeCoatingLibraryIndex(t *testing.T, dataDir, module, stamp string) string {
	t.Helper()
	folder, ok := coatingLibraryFolder(module)
	if !ok {
		t.Fatalf("module %q is not a coating library", module)
	}
	dir := filepath.Join(dataDir, folder)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"ekur_stamp":"` + stamp + `","schema":` + strconv.Itoa(coatingLibrarySchema(module)) + `}`
	if err := os.WriteFile(filepath.Join(dir, "index.json"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

// TestCoatingLibraryReadyStampMatch — a library whose recorded stamp equals the current
// export stamp is ready.
func TestCoatingLibraryReadyStampMatch(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	data := t.TempDir()
	ekur := filepath.Join(data, "ekur")
	ekurFixtureCmd(t, ekur)
	stamp, err := spartanpieces.EkurStamp(ekur)
	if err != nil {
		t.Fatal(err)
	}
	writeCoatingLibraryIndex(t, data, meshjobs.JobSpartanPieces, stamp)
	if !coatingLibraryReady(data, meshjobs.JobSpartanPieces) {
		t.Fatal("stamp match: library not ready")
	}
}

// TestCoatingLibraryReadyStampMismatch — a library whose recorded stamp differs from the
// current export stamp is not ready.
func TestCoatingLibraryReadyStampMismatch(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	data := t.TempDir()
	ekur := filepath.Join(data, "ekur")
	ekurFixtureCmd(t, ekur)
	writeCoatingLibraryIndex(t, data, meshjobs.JobWeapons, "00000000")
	if coatingLibraryReady(data, meshjobs.JobWeapons) {
		t.Fatal("stamp mismatch: library ready")
	}
}

// TestCoatingLibraryReadyNoDowngrade — with no export available (no variable, no
// <data>/ekur), an existing library is ready whatever its recorded stamp: an export that
// disappears never forces a rebuild.
func TestCoatingLibraryReadyNoDowngrade(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	data := t.TempDir()
	writeCoatingLibraryIndex(t, data, meshjobs.JobFirstPerson, "deadbeef")
	if !coatingLibraryReady(data, meshjobs.JobFirstPerson) {
		t.Fatal("no export: existing library not ready (downgrade)")
	}
	// A library without an index is still not ready.
	data2 := t.TempDir()
	if coatingLibraryReady(data2, meshjobs.JobFirstPerson) {
		t.Fatal("no index: library ready")
	}
}

// TestCoatingLibraryReadyNoStampOldIndex — a library without a recorded stamp (built before
// stamps existed) is ready without an export and not ready when one appears.
func TestCoatingLibraryReadyNoStampOldIndex(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	data := t.TempDir()
	writeCoatingLibraryIndex(t, data, meshjobs.JobSpartanPieces, "")
	if !coatingLibraryReady(data, meshjobs.JobSpartanPieces) {
		t.Fatal("old index, no export: library not ready")
	}
	ekur := t.TempDir()
	ekurFixtureCmd(t, ekur)
	t.Setenv(spartanpieces.EkurEnv, ekur)
	if coatingLibraryReady(data, meshjobs.JobSpartanPieces) {
		t.Fatal("old index, export present: library ready")
	}
}

// TestMoveStaleCoatingLibrarySuccess — the stale rename moves the library aside, the
// cleanup removes it, and an older .stale is replaced (not kept) on the second move.
func TestMoveStaleCoatingLibrarySuccess(t *testing.T) {
	data := t.TempDir()
	dir := writeCoatingLibraryIndex(t, data, meshjobs.JobWeapons, "00000000")
	stale := dir + staleSuffix
	moveStaleCoatingLibrary(data, meshjobs.JobWeapons)
	if _, err := os.Stat(stale); err != nil {
		t.Fatalf("stale folder not in place: %v", err)
	}
	if _, err := os.Stat(dir); err == nil {
		t.Fatal("original folder still present after rename")
	}
	// An older .stale is replaced by the move (the cleanup first, the rename on top).
	if err := os.MkdirAll(filepath.Join(stale, "old"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	moveStaleCoatingLibrary(data, meshjobs.JobWeapons)
	if _, err := os.Stat(filepath.Join(stale, "old")); err == nil {
		t.Fatal("older .stale survived the replacement")
	}
	// The cleanup removes the .stale once the rebuild succeeded.
	removeStaleCoatingLibrary(data, meshjobs.JobWeapons)
	if _, err := os.Stat(stale); err == nil {
		t.Fatal("stale folder survived the cleanup")
	}
}

// TestRemoveStaleRefusesSymlink — a .stale folder that contains a symlink is left in
// place: the refusal to follow it is an error, and nothing under it is touched.
func TestRemoveStaleRefusesSymlink(t *testing.T) {
	data := t.TempDir()
	dir := writeCoatingLibraryIndex(t, data, meshjobs.JobSpartanPieces, "00000000")
	moveStaleCoatingLibrary(data, meshjobs.JobSpartanPieces)
	stale := dir + staleSuffix
	target := filepath.Join(data, "precious.json")
	if err := os.WriteFile(target, []byte("keep me"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(stale, "link.json")); err != nil {
		t.Skipf("cannot create symlink in this environment: %v", err)
	}
	if err := removeTreeRefusingSymlinks(stale, "stale library"); err == nil {
		t.Fatal("cleanup succeeded despite a symlink in the stale folder")
	}
	if _, err := os.Stat(stale); err != nil {
		t.Fatal("stale folder removed despite a symlink")
	}
	if _, err := os.Stat(target); err != nil {
		t.Fatal("symlink target removed: the refusal must not follow it")
	}
}

// TestRestoreStaleAfterFailedBuild — when a rebuild fails, the failed build's partial
// folder is removed and the previous library comes back from .stale (an out-of-date
// library still renders; an absent one renders nothing).
func TestRestoreStaleAfterFailedBuild(t *testing.T) {
	data := t.TempDir()
	dir := writeCoatingLibraryIndex(t, data, meshjobs.JobWeapons, "old")
	moveStaleCoatingLibrary(data, meshjobs.JobWeapons)
	// The failed build left a partial folder with no index.
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "partial.glb"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	restoreStaleCoatingLibrary(data, meshjobs.JobWeapons)
	if stamp, ok := recordedEkurStamp(data, meshjobs.JobWeapons); !ok || stamp != "old" {
		t.Fatalf("previous library not restored: stamp %q ok %v", stamp, ok)
	}
	if _, err := os.Stat(filepath.Join(dir, "partial.glb")); err == nil {
		t.Fatal("partial build file survived the restore")
	}
	if _, err := os.Stat(dir + staleSuffix); err == nil {
		t.Fatal(".stale folder still present after the restore")
	}
	// Without a .stale folder, a failed build leaves things as they are.
	restoreStaleCoatingLibrary(data, meshjobs.JobWeapons)
	if _, ok := recordedEkurStamp(data, meshjobs.JobWeapons); !ok {
		t.Fatal("restore without .stale removed the library")
	}
}

// ekurFixtureCmd lays down the five contract entries of an Ekur reference in folder (the
// cmd-level twin of the spartanpieces fixture: this package cannot import that test file).
func ekurFixtureCmd(t *testing.T, folder string) {
	t.Helper()
	mustWrite := func(rel, body string) {
		t.Helper()
		p := filepath.Join(folder, rel)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	mustWrite("materials/123.json", `{}`)
	mustWrite("stylelists/456.json", `{}`)
	mustWrite("styles/-177284589.json", `{}`)
	mustWrite("globals.json", `{"entries":{}}`)
	mustWrite("visor_data.json", `{"patterns":{},"colors":{}}`)
}
