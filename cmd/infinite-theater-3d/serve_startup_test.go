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
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
)

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

// TestStartupBuildsOrderAndOnce — the startup step enqueues the four libraries in the
// fixed order first (weapon icons, HUD icons, weapon library, first-person library), then
// each distinct map module once, with a match's variant following; an output that is ready
// is skipped.
func TestStartupBuildsOrderAndOnce(t *testing.T) {
	rr := newRecordingRunner(t, func(string) bool { return false })
	matches := []startupMatch{
		{MatchID: "aaaa", MapModule: "moda"},
		{MatchID: "bbbb", MapModule: "moda"}, // same module as aaaa: queued once
		{MatchID: "cccc", MapModule: "modb"},
	}
	// bbbb shares aaaa's map module but has a variant of its own: its variant is still queued.
	variantExists := func(id string) bool { return id == "aaaa" || id == "bbbb" }
	enqueueStartupBuilds(rr, rr.ready, matches, variantExists)
	want := []string{
		meshjobs.JobWeaponIcons, meshjobs.JobHudIcons, meshjobs.JobWeapons,
		meshjobs.JobFirstPerson, "moda", "variant:aaaa", "variant:bbbb", "modb",
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
		{MatchID: "aaaa", MapModule: "moda"},
		{MatchID: "bbbb", MapModule: "moda"},
		{MatchID: "cccc", MapModule: "modb"},
	}
	enqueueStartupBuilds(rr, rr.ready, matches, func(id string) bool { return id == "bbbb" })
	want := []string{meshjobs.JobHudIcons, meshjobs.JobWeapons, meshjobs.JobFirstPerson, "moda"}
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
	runServeStartup(rr, rr.ready, root, "")
	if got := rr.modules(); len(got) != 0 {
		t.Fatalf("queued = %v, want nothing (no install)", got)
	}
}

// TestStartupBuildsFoundInstall — when the install is found the startup step enqueues the
// four libraries and, for the store's matches, the two distinct map modules and the one
// stored variant.
func TestStartupBuildsFoundInstall(t *testing.T) {
	root := startupTestStore(t)
	rr := newRecordingRunner(t, func(string) bool { return false })
	t.Setenv("LEVELUP_HALO_DEPLOY", t.TempDir())
	runServeStartup(rr, rr.ready, root, "")
	// The four libraries lead, in order; the two distinct map modules and the one stored
	// variant follow (their relative order is the store's listing order, newest import
	// first, a tie broken by id).
	got := rr.modules()
	if len(got) != 7 || got[0] != meshjobs.JobWeaponIcons || got[1] != meshjobs.JobHudIcons ||
		got[2] != meshjobs.JobWeapons || got[3] != meshjobs.JobFirstPerson {
		t.Fatalf("queued = %v, want the four libraries first in order", got)
	}
	for _, want := range []string{"moda", "variant:bbbb", "modb"} {
		found := false
		for _, m := range got[3:] {
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
