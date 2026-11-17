// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_startup_test.go — the serve startup step: with a fake store, a fake runner and a
// fake readiness function, the step enqueues every one-time build that is not ready yet,
// in the fixed order (weapon icons, weapon library, first-person library, then each match's
// map mesh and variant layer), skips an output that is already on disk, queues each
// distinct map module once, and queues nothing when no game install is found. No test uses
// a real game install.

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

// writeEkurExport writes the five entries of the Ekur contract into dir, making it a valid
// export (spartanpieces.EkurValid).
func writeEkurExport(t *testing.T, dir string) {
	t.Helper()
	for _, e := range spartanpieces.EkurEntries {
		p := filepath.Join(dir, e.Name)
		if e.IsDir {
			if err := os.MkdirAll(p, 0o700); err != nil {
				t.Fatal(err)
			}
		} else {
			if err := os.MkdirAll(filepath.Dir(p), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(p, []byte("{}"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
	}
}

// startupTestStore builds a temp store with three matches: "aaaa" and "bbbb" share the map
// module "moda" (bbbb stores a map variant), "cccc" is on "modb". Neither module has a mesh
// file on disk, and the libraries are unbuilt. (The match ids are hex: a variant job id is
// a match id and must validate.)
func startupTestStore(t *testing.T) *store.Root {
	t.Helper()
	root, err := store.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for id, module := range map[string]string{"aaaa": "moda", "bbbb": "moda", "cccc": "modb"} {
		if err := root.SaveMatchMeta(id, store.Match{MatchID: id, MapName: "M", MapModule: module, ImportedAt: "2026-01-01T00:00:00Z"}); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(variantPath(root, "bbbb", "map.mvar"), []byte("mvar"), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}

// recordingRunner is a meshjobs.Runner that only records the modules it is asked to
// enqueue: its builder is a no-op and its ready callback is the test's fake, so no build
// ever runs and nothing is on disk. ready is the same fake handed to the runner, the one
// the startup step checks.
type recordingRunner struct {
	*meshjobs.Runner
	ready   func(string) bool
	ordered []string
}

// Enqueue records the request, then defers to the runner's real Enqueue (dedupe, state).
func (r *recordingRunner) Enqueue(module string) meshjobs.Snapshot {
	r.ordered = append(r.ordered, module)
	return r.Runner.Enqueue(module)
}

func (r *recordingRunner) modules() []string {
	out := make([]string, len(r.ordered))
	copy(out, r.ordered)
	return out
}

func newRecordingRunner(t *testing.T, ready func(string) bool) *recordingRunner {
	t.Helper()
	r, err := meshjobs.New(func(ctx context.Context, module, gameRoot, out string) (meshjobs.BuildResult, error) {
		return meshjobs.BuildResult{}, nil
	}, "", ready)
	if err != nil {
		t.Fatal(err)
	}
	rec := &recordingRunner{Runner: r, ready: ready}
	r.SetDest(func(module string) string { return module })
	return rec
}

// TestStartupBuildsOrderAndOnce — the startup step enqueues the five libraries in the
// fixed order first (weapon icons, HUD icons, rank badges, weapon library, first-person
// library), then
// each distinct map module once, with a match's variant following; an output that is ready
// is skipped.
func TestStartupBuildsOrderAndOnce(t *testing.T) {
	rr := newRecordingRunner(t, func(string) bool { return false })
	matches := []startupMatch{
		{MatchID: "aaaa", MeshKey: "moda"},
		{MatchID: "bbbb", MeshKey: "moda"}, // same module as aaaa: queued once
		{MatchID: "cccc", MeshKey: "modb"},
	}
	// bbbb shares aaaa's map module but has a variant of its own: its variant is still queued.
	variantExists := func(id string) bool { return id == "aaaa" || id == "bbbb" }
	enqueueStartupBuilds(rr, rr.ready, nil, matches, variantExists, false)
	want := []string{
		meshjobs.JobWeaponIcons, meshjobs.JobHudIcons, meshjobs.JobRanks, meshjobs.JobBackdrop, meshjobs.JobAnnouncer,
		meshjobs.JobWeapons, meshjobs.JobFirstPerson, meshjobs.JobSpartanPieces,
		"moda", "variant:aaaa", "variant:bbbb", "modb",
	}
	if got := rr.modules(); !reflect.DeepEqual(got, want) {
		t.Fatalf("queued = %v, want %v", got, want)
	}
}

// TestStartupBuildsSkipsReady — an output that is already on disk is not queued.
func TestStartupBuildsSkipsReady(t *testing.T) {
	ready := map[string]bool{meshjobs.JobWeaponIcons: true, "modb": true, "variant:bbbb": true}
	rr := newRecordingRunner(t, func(m string) bool { return ready[m] })
	matches := []startupMatch{
		{MatchID: "aaaa", MeshKey: "moda"},
		{MatchID: "bbbb", MeshKey: "moda"},
		{MatchID: "cccc", MeshKey: "modb"},
	}
	enqueueStartupBuilds(rr, rr.ready, nil, matches, func(id string) bool { return id == "bbbb" }, false)
	want := []string{meshjobs.JobHudIcons, meshjobs.JobRanks, meshjobs.JobBackdrop, meshjobs.JobAnnouncer, meshjobs.JobWeapons,
		meshjobs.JobFirstPerson, meshjobs.JobSpartanPieces, "moda"}
	if got := rr.modules(); !reflect.DeepEqual(got, want) {
		t.Fatalf("queued = %v, want %v", got, want)
	}
}

// TestStartupBuildsUpdatesOutdatedHigh — a High map or variant file on disk in an older build
// format is queued after its Standard counterpart (its update runs in place); a High file that is
// current or absent is not (High is never built from nothing at startup).
func TestStartupBuildsUpdatesOutdatedHigh(t *testing.T) {
	ready := map[string]bool{meshjobs.JobWeaponIcons: true, meshjobs.JobHudIcons: true, meshjobs.JobRanks: true,
		meshjobs.JobBackdrop: true, meshjobs.JobAnnouncer: true, meshjobs.JobWeapons: true, meshjobs.JobFirstPerson: true,
		meshjobs.JobSpartanPieces: true, "modb": true, "variant:bbbb": true}
	outdated := map[string]bool{
		meshjobs.JobKey("moda", meshjobs.QualityHigh):         true,
		meshjobs.JobKey("variant:bbbb", meshjobs.QualityHigh): true,
	}
	rr := newRecordingRunner(t, func(m string) bool { return ready[m] })
	matches := []startupMatch{
		{MatchID: "aaaa", MeshKey: "moda"},
		{MatchID: "bbbb", MeshKey: "moda"},
		{MatchID: "cccc", MeshKey: "modb"},
	}
	enqueueStartupBuilds(rr, rr.ready, func(m string) bool { return outdated[m] }, matches, func(id string) bool { return id == "bbbb" }, false)
	want := []string{"moda", meshjobs.JobKey("moda", meshjobs.QualityHigh), meshjobs.JobKey("variant:bbbb", meshjobs.QualityHigh)}
	if got := rr.modules(); !reflect.DeepEqual(got, want) {
		t.Fatalf("queued = %v, want %v", got, want)
	}
}

// TestStartupBuildsNoInstall — when no game install is found the startup step queues
// nothing, whatever the store holds.
func TestStartupBuildsNoInstall(t *testing.T) {
	root := startupTestStore(t)
	rr := newRecordingRunner(t, func(string) bool { return false })
	t.Setenv("LEVELUP_HALO_DEPLOY", filepath.Join(t.TempDir(), "absent"))
	runServeStartup(rr, rr.ready, nil, root, "", nil)
	if got := rr.modules(); len(got) != 0 {
		t.Fatalf("queued = %v, want nothing (no install)", got)
	}
}

// TestStartupBuildsFoundInstall — when the install is found the startup step enqueues the
// seven libraries and, for the store's matches, the two distinct map modules and the one
// stored variant.
func TestStartupBuildsFoundInstall(t *testing.T) {
	root := startupTestStore(t)
	rr := newRecordingRunner(t, func(string) bool { return false })
	t.Setenv("LEVELUP_HALO_DEPLOY", t.TempDir())
	runServeStartup(rr, rr.ready, nil, root, "", nil)
	// The seven libraries lead, in order; the two distinct map modules and the one stored
	// variant follow (their relative order is the store's listing order, newest import
	// first, a tie broken by id).
	got := rr.modules()
	if len(got) != 11 || got[0] != meshjobs.JobWeaponIcons || got[1] != meshjobs.JobHudIcons ||
		got[2] != meshjobs.JobRanks || got[3] != meshjobs.JobBackdrop || got[4] != meshjobs.JobAnnouncer ||
		got[5] != meshjobs.JobWeapons || got[6] != meshjobs.JobFirstPerson || got[7] != meshjobs.JobSpartanPieces {
		t.Fatalf("queued = %v, want the eight libraries first in order", got)
	}
	for _, want := range []string{"moda", "variant:bbbb", "modb"} {
		found := false
		for _, m := range got[8:] {
			if m == want {
				found = true
				break
			}
		}
		if !found {
			t.Fatalf("queued = %v, want %q among the map builds", got, want)
		}
	}
}

// TestStartupStartsCoatingsSetup — with a found install, no valid export and no override,
// the startup starts the coatings setup and leaves the three coating libraries unqueued
// (the setup's own completion step queues them).
func TestStartupStartsCoatingsSetup(t *testing.T) {
	root := startupTestStore(t)
	rr := newRecordingRunner(t, func(string) bool { return false })
	deploy := t.TempDir()
	started := false
	runServeStartup(rr, rr.ready, nil, root, deploy, func() { started = true })
	if !started {
		t.Fatal("the coatings setup was not started (no valid export, no override, install found)")
	}
	for _, module := range coatingLibraryModules {
		if slices.Contains(rr.modules(), module) {
			t.Fatalf("queued = %v: the startup enqueued coating library %s; the setup must queue it", rr.modules(), module)
		}
	}
	// The other one-time builds are still enqueued.
	for _, module := range []string{meshjobs.JobWeaponIcons, meshjobs.JobHudIcons, meshjobs.JobRanks, meshjobs.JobBackdrop, meshjobs.JobAnnouncer} {
		if !slices.Contains(rr.modules(), module) {
			t.Fatalf("queued = %v, want %s enqueued", rr.modules(), module)
		}
	}
}

// TestStartupValidExportSkipsSetup — with a valid export in <data>/ekur the startup does
// not run the setup and enqueues the three coating libraries as today.
func TestStartupValidExportSkipsSetup(t *testing.T) {
	root := startupTestStore(t)
	writeEkurExport(t, spartanpieces.DataEkurDir(root.Dir()))
	rr := newRecordingRunner(t, func(string) bool { return false })
	deploy := t.TempDir()
	started := false
	runServeStartup(rr, rr.ready, nil, root, deploy, func() { started = true })
	if started {
		t.Fatal("the setup ran with a valid export in place")
	}
	for _, module := range coatingLibraryModules {
		if !slices.Contains(rr.modules(), module) {
			t.Fatalf("queued = %v, want the coating library %s enqueued", rr.modules(), module)
		}
	}
}

// TestStartupOverrideSkipsSetup — with the override variable set the startup never runs
// the setup and enqueues the three coating libraries as today.
func TestStartupOverrideSkipsSetup(t *testing.T) {
	root := startupTestStore(t)
	rr := newRecordingRunner(t, func(string) bool { return false })
	deploy := t.TempDir()
	t.Setenv(spartanpieces.EkurEnv, t.TempDir())
	started := false
	runServeStartup(rr, rr.ready, nil, root, deploy, func() { started = true })
	if started {
		t.Fatal("the setup ran under the override")
	}
	for _, module := range coatingLibraryModules {
		if !slices.Contains(rr.modules(), module) {
			t.Fatalf("queued = %v, want the coating library %s enqueued", rr.modules(), module)
		}
	}
}
