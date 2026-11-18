// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
)

// TestBuildLabels — libraries by name, a Forge layer and a map by the stored match's map
// name, anything else as its key.
func TestBuildLabels(t *testing.T) {
	l := &buildLabeler{root: newFakeStore(t)}
	for key, want := range map[string]string{
		"weapons":        "Weapons",
		"spartan-pieces": "Armor",
		"first-person":   "First-person arms",
		"announcer":      "Announcer sounds",
		"variant:abc":    "Test Map Forge layer",
		"variant:zzz":    "Forge layer",
		"moda":           "Test Map map",
		"modz":           "modz",
		"abc":            "Test Map map",
		meshjobs.JobKey("moda", meshjobs.QualityHigh):        "Test Map map (HQ)",
		meshjobs.JobKey("variant:abc", meshjobs.QualityHigh): "Test Map Forge layer (HQ)",
		meshjobs.JobKey("weapons", meshjobs.QualityHigh):     "Weapons (HQ)",
	} {
		if got := l.label(key); got != want {
			t.Errorf("label(%q) = %q, want %q", key, got, want)
		}
	}
}

// TestBuildsRoute — idle: nothing active, an empty queue; while a build runs, the active
// build and the queue in order, labeled, and the read-only mode serves it.
func TestBuildsRoute(t *testing.T) {
	root := newFakeStore(t)
	release := make(chan struct{})
	jobs, err := meshjobs.New(func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		select {
		case <-release:
		case <-ctx.Done():
		}
		return meshjobs.BuildResult{}, ctx.Err()
	}, "", func(string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	h := newTestHandlers(root, jobs)

	type body struct {
		Active *struct {
			Key, Label string
			ElapsedMs  int64
		} `json:"active"`
		Queued []struct{ Key, Label string } `json:"queued"`
	}
	read := func() body {
		t.Helper()
		rec := get(t, h.readOnlyHandler(), "/api/builds", nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d %s", rec.Code, rec.Body.String())
		}
		var b body
		if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
			t.Fatalf("body %s: %v", rec.Body.String(), err)
		}
		return b
	}
	if b := read(); b.Active != nil || len(b.Queued) != 0 {
		t.Fatalf("idle = %+v, want nothing", b)
	}

	jobs.Start()
	defer func() { close(release); jobs.Stop(time.Second) }()
	jobs.Enqueue("variant:abc")
	deadline := time.Now().Add(2 * time.Second)
	for jobs.Snapshot("variant:abc").State != meshjobs.StateBuilding && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	jobs.Enqueue(meshjobs.JobWeapons)
	jobs.Enqueue("moda-not-stored")
	b := read()
	if b.Active == nil || b.Active.Key != "variant:abc" || b.Active.Label != "Test Map Forge layer" {
		t.Fatalf("active = %+v", b.Active)
	}
	if len(b.Queued) != 2 || b.Queued[0].Label != "Weapons" || b.Queued[1].Label != "moda-not-stored" {
		t.Fatalf("queued = %+v", b.Queued)
	}
}

// TestStepLabel — a stage that looks like "<n>/<m>" is appended to the label; anything else
// (including no stage at all) leaves the label alone.
func TestStepLabel(t *testing.T) {
	for _, tc := range []struct{ label, stage, want string }{
		{"Weapons", "84/190", "Weapons 84/190"},
		{"First-person arms", "12/204", "First-person arms 12/204"},
		{"Weapons", "", "Weapons"},
		{"Weapons", "textures", "Weapons"},
		{"Weapons", "84/", "Weapons"},
		{"Weapons", "/190", "Weapons"},
		{"Weapons", "a/b", "Weapons"},
	} {
		if got := stepLabel(tc.label, tc.stage); got != tc.want {
			t.Errorf("stepLabel(%q, %q) = %q, want %q", tc.label, tc.stage, got, tc.want)
		}
	}
}

// TestOverallProgressJSON — zero total is fraction 0; otherwise done plus the active job's own
// fraction, over total, clamped to [0,1].
func TestOverallProgressJSON(t *testing.T) {
	if got := overallProgressJSON(0, 0, nil); got["fraction"] != 0.0 {
		t.Fatalf("empty = %+v", got)
	}
	got := overallProgressJSON(1, 4, &meshjobs.Snapshot{Progress: 0.5})
	if got["done"] != 1 || got["total"] != 4 {
		t.Fatalf("got = %+v", got)
	}
	if f := got["fraction"].(float64); f < 0.374 || f > 0.376 {
		t.Fatalf("fraction = %v, want ~0.375", f)
	}
	// A total smaller than done+active (a job enqueued, then the counters read mid-race)
	// never reports more than fully done.
	clamped := overallProgressJSON(3, 3, &meshjobs.Snapshot{Progress: 0.9})
	if f := clamped["fraction"].(float64); f != 1 {
		t.Fatalf("fraction = %v, want 1 (clamped)", f)
	}
}

// TestBuildsRoute_Overall — GET /api/builds carries the overall fraction and a combined step
// label while a build with its own unit count runs.
func TestBuildsRoute_Overall(t *testing.T) {
	root := newFakeStore(t)
	release := make(chan struct{})
	jobs, err := meshjobs.New(func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		if rep := meshjobs.ProgressFromContext(ctx); rep != nil {
			rep.Report(0.5, "84/190")
		}
		select {
		case <-release:
		case <-ctx.Done():
		}
		return meshjobs.BuildResult{}, ctx.Err()
	}, "", func(string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	h := newTestHandlers(root, jobs)
	jobs.Start()
	defer func() { close(release); jobs.Stop(time.Second) }()
	jobs.Enqueue(meshjobs.JobWeapons)
	deadline := time.Now().Add(2 * time.Second)
	for jobs.Snapshot(meshjobs.JobWeapons).Progress == 0 && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}

	rec := get(t, h.readOnlyHandler(), "/api/builds", nil)
	var b struct {
		Active  struct{ Step string } `json:"active"`
		Overall struct {
			Done, Total int
			Fraction    float64
		} `json:"overall"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("body %s: %v", rec.Body.String(), err)
	}
	if b.Active.Step != "Weapons 84/190" {
		t.Fatalf("step = %q, want %q", b.Active.Step, "Weapons 84/190")
	}
	if b.Overall.Total != 1 || b.Overall.Fraction <= 0 || b.Overall.Fraction >= 1 {
		t.Fatalf("overall = %+v, want total 1 and a fraction strictly between 0 and 1", b.Overall)
	}
}
