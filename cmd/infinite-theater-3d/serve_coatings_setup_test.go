// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_coatings_setup_test.go — the coatings setup routes: the start/state pair, the
// loopback and read-only refusals, the single-flight 409, the failure message, the coating
// library rebuilds queued after a successful run (including one whose build was running
// when the export changed), and the IT3D_EKUR_DIR override. The setup itself is a fake
// (internal/ekursetup has its own tests); nothing here writes from a real game install.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/ekursetup"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// buildCounter is a mesh jobs runner whose builds only count per module (and fail, so a
// module never turns ready); hold, when set, blocks a module's first build until released.
type buildCounter struct {
	mu      sync.Mutex
	counts  map[string]int
	hold    string
	release chan struct{}
}

func (b *buildCounter) count(module string) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.counts[module]
}

func newBuildCounter(t *testing.T, hold string) (*buildCounter, *meshjobs.Runner) {
	t.Helper()
	b := &buildCounter{counts: map[string]int{}, hold: hold, release: make(chan struct{})}
	build := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		b.mu.Lock()
		b.counts[module]++
		first := b.counts[module] == 1
		b.mu.Unlock()
		if module == b.hold && first {
			select {
			case <-b.release:
			case <-ctx.Done():
			}
		}
		return meshjobs.BuildResult{}, errors.New("test build")
	}
	r, err := meshjobs.New(build, "", func(string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	r.Start()
	t.Cleanup(func() { r.Stop(time.Second) })
	return b, r
}

// waitFor polls cond until it holds or fails the test after a few seconds.
func waitForSetup(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// setupState reads GET /api/coatings/setup/state.
func setupState(t *testing.T, h http.Handler) coatingsSetupState {
	t.Helper()
	rec := get(t, h, "/api/coatings/setup/state", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("state = %d; body=%s", rec.Code, rec.Body.String())
	}
	var s coatingsSetupState
	if err := json.Unmarshal(rec.Body.Bytes(), &s); err != nil {
		t.Fatal(err)
	}
	return s
}

// fakeSetupRun reports every ekursetup stage and writes a valid export into <data>/ekur,
// as a successful real run leaves it. It runs on the job's goroutine, so it reports a
// write failure as its error rather than through t.
func fakeSetupRun(dataDir string) func(context.Context, func(ekursetup.Stage)) error {
	return func(_ context.Context, progress func(ekursetup.Stage)) error {
		for _, s := range []ekursetup.Stage{ekursetup.StageExtracting, ekursetup.StageValidating} {
			progress(s)
		}
		dir := spartanpieces.DataEkurDir(dataDir)
		for rel, body := range map[string]string{
			"materials/123.json":     `{}`,
			"stylelists/456.json":    `{}`,
			"styles/-177284589.json": `{}`,
			"globals.json":           `{"entries":{}}`,
			"visor_data.json":        `{"patterns":{},"colors":{}}`,
		} {
			p := filepath.Join(dir, filepath.FromSlash(rel))
			if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
				return err
			}
			if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
				return err
			}
		}
		return nil
	}
}

// TestCoatingsSetupRoute — idle before any run; a foreign Origin and the read-only mode are
// refused; a POST answers 202, the state ends ready, the export reads ok, and every coating
// library is queued for its rebuild.
func TestCoatingsSetupRoute(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	counter, jobs := newBuildCounter(t, "")
	h := newTestHandlers(newFakeStore(t), jobs)
	h.coatingsSetup.run = fakeSetupRun(h.root.Dir())

	if s := setupState(t, h); s.State != setupIdle {
		t.Fatalf("initial state = %+v, want idle", s)
	}
	if rec := postMesh(t, h, "/api/coatings/setup", map[string]string{"Origin": "https://evil.example.com"}); rec.Code != http.StatusForbidden {
		t.Fatalf("cross-origin setup = %d, want 403", rec.Code)
	}
	ro := h
	ro.readOnly = true
	if rec := post(t, ro.readOnlyHandler(), "/api/coatings/setup"); rec.Code != http.StatusForbidden || !strings.Contains(rec.Body.String(), "read_only") {
		t.Fatalf("read-only setup = %d %s, want 403 read_only", rec.Code, rec.Body.String())
	}
	if s := setupState(t, h); s.State != setupIdle {
		t.Fatalf("a refused setup changed the state: %+v", s)
	}

	rec := postMesh(t, h, "/api/coatings/setup", nil)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("setup = %d, want 202; body=%s", rec.Code, rec.Body.String())
	}
	waitForSetup(t, "setup ready", func() bool { return setupState(t, h).State == setupReady })
	if out := getCoatingStatus(t, h); out.Export != exportOk || out.Override {
		t.Fatalf("coating status after setup = %+v, want ok without override", out)
	}
	for _, module := range coatingLibraryModules {
		waitForSetup(t, module+" rebuild", func() bool { return counter.count(module) >= 1 })
	}
}

// TestCoatingsSetupFailure — a failed run reports failed with the setup's own message and
// still queues the coating libraries once (they build without coatings), because a startup
// that started the setup leaves their queuing to it.
func TestCoatingsSetupFailure(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	counter, jobs := newBuildCounter(t, "")
	h := newTestHandlers(newFakeStore(t), jobs)
	h.coatingsSetup.run = func(_ context.Context, progress func(ekursetup.Stage)) error {
		progress(ekursetup.StageExtracting)
		return fmt.Errorf("setup failed: it exited with code 3")
	}
	if rec := postMesh(t, h, "/api/coatings/setup", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("setup = %d, want 202", rec.Code)
	}
	waitForSetup(t, "setup failed", func() bool { return setupState(t, h).State == setupFailed })
	if s := setupState(t, h); !strings.Contains(s.Error, "exited with code 3") {
		t.Fatalf("failure message = %q", s.Error)
	}
	for _, module := range coatingLibraryModules {
		waitForSetup(t, module+" build after a failed setup", func() bool { return counter.count(module) >= 1 })
	}
	time.Sleep(20 * time.Millisecond)
	for _, module := range coatingLibraryModules {
		if n := counter.count(module); n != 1 {
			t.Fatalf("%s built %d times after a failed setup, want 1", module, n)
		}
	}
	// A failed run frees the job: the next POST starts a new one.
	if rec := postMesh(t, h, "/api/coatings/setup", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("retry = %d, want 202", rec.Code)
	}
	waitForSetup(t, "retry failed", func() bool { return setupState(t, h).State == setupFailed })
}

// TestCoatingsSetupConflict — a second POST while a run is in flight answers 409 and does
// not start a second run.
func TestCoatingsSetupConflict(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	_, jobs := newBuildCounter(t, "")
	h := newTestHandlers(newFakeStore(t), jobs)
	release := make(chan struct{})
	calls := 0
	var mu sync.Mutex
	h.coatingsSetup.run = func(_ context.Context, progress func(ekursetup.Stage)) error {
		mu.Lock()
		calls++
		mu.Unlock()
		progress(ekursetup.StageExtracting)
		<-release
		return errors.New("stopped")
	}
	if rec := postMesh(t, h, "/api/coatings/setup", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("setup = %d, want 202", rec.Code)
	}
	waitForSetup(t, "extracting", func() bool { return setupState(t, h).State == string(ekursetup.StageExtracting) })
	if rec := postMesh(t, h, "/api/coatings/setup", nil); rec.Code != http.StatusConflict {
		t.Fatalf("second setup = %d, want 409", rec.Code)
	}
	close(release)
	waitForSetup(t, "failed", func() bool { return setupState(t, h).State == setupFailed })
	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Fatalf("setup ran %d times, want 1", calls)
	}
}

// TestCoatingsSetupRequeuesRunningBuild — a coating library whose build was running when the
// export changed (it read the old one) is rebuilt once that build ends.
func TestCoatingsSetupRequeuesRunningBuild(t *testing.T) {
	t.Setenv(spartanpieces.EkurEnv, "")
	counter, jobs := newBuildCounter(t, meshjobs.JobWeapons)
	h := newTestHandlers(newFakeStore(t), jobs)
	h.coatingsSetup.run = fakeSetupRun(h.root.Dir())
	h.coatingsSetup.requeuePoll = 5 * time.Millisecond

	jobs.Enqueue(meshjobs.JobWeapons)
	waitForSetup(t, "weapons building", func() bool { return jobs.Snapshot(meshjobs.JobWeapons).State == meshjobs.StateBuilding })
	if rec := postMesh(t, h, "/api/coatings/setup", nil); rec.Code != http.StatusAccepted {
		t.Fatalf("setup = %d, want 202", rec.Code)
	}
	waitForSetup(t, "setup ready", func() bool { return setupState(t, h).State == setupReady })
	if n := counter.count(meshjobs.JobWeapons); n != 1 {
		t.Fatalf("weapons built %d times while its first build runs, want 1", n)
	}
	close(counter.release)
	waitForSetup(t, "weapons rebuilt", func() bool { return counter.count(meshjobs.JobWeapons) >= 2 })
}

// TestCoatingsSetupOverride — with IT3D_EKUR_DIR set, the status route says so (without the
// value) and the real setup refuses before resolving the game.
func TestCoatingsSetupOverride(t *testing.T) {
	envDir := t.TempDir()
	t.Setenv(spartanpieces.EkurEnv, envDir)
	h := newTestHandlers(newFakeStore(t), nil)
	out := getCoatingStatus(t, h)
	if !out.Override || out.Export != exportInvalid {
		t.Fatalf("status = %+v, want override and invalid (an empty folder)", out)
	}
	if strings.Contains(recBody(t, h), envDir) {
		t.Fatal("status leaks the variable's value")
	}
	if err := h.defaultCoatingsSetup(context.Background(), func(ekursetup.Stage) {}); !errors.Is(err, ekursetup.ErrOverride) {
		t.Fatalf("setup under the override: err = %v, want ErrOverride", err)
	}
	// The override wins over a valid <data>/ekur: the builds still read the variable.
	ekurFixtureCmd(t, spartanpieces.DataEkurDir(h.root.Dir()))
	if got := spartanpieces.EkurDir(h.root.Dir()); got != "" {
		t.Fatalf("EkurDir = %q, want the (invalid) override to win", got)
	}
}
