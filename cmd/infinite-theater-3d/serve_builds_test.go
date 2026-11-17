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
