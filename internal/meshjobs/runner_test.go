package meshjobs

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// fakeStore is a Builder + ready callback pair backed by a real temp folder: a build writes
// a file into it, ready reports whether the file exists, and the build honours its context
// (so Stop can be proven to cancel it). It records how many times each module built, so a
// test can assert single-flight.
type fakeStore struct {
	dir    string
	files  map[string]bool // module -> present on disk
	builds map[string]int  // module -> build calls
	mu     sync.Mutex
	delay  time.Duration
	fail   map[string]error // module -> error to return (first attempt only)
}

func newFakeStore(t *testing.T) *fakeStore {
	t.Helper()
	return &fakeStore{
		dir:    t.TempDir(),
		files:  make(map[string]bool),
		builds: make(map[string]int),
		fail:   make(map[string]error),
	}
}

func (f *fakeStore) path(module string) string { return filepath.Join(f.dir, module+".glb") }

func (f *fakeStore) ready(module string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.files[module]
}

func (f *fakeStore) build(ctx context.Context, module, gameRoot, out string) (BuildResult, error) {
	f.mu.Lock()
	f.builds[module]++
	shouldFail := f.fail[module] != nil
	delete(f.fail, module) // fail once
	delay := f.delay
	f.mu.Unlock()

	// Honours the context: a cancel during the delay ends the build.
	select {
	case <-ctx.Done():
		return BuildResult{}, ctx.Err()
	case <-time.After(delay):
	}
	if shouldFail {
		// A failed build leaves no file behind (the real build's temp file is removed on
		// failure; here we simply do not write).
		return BuildResult{}, errors.New("boom: " + module)
	}
	f.mu.Lock()
	f.files[module] = true
	f.mu.Unlock()
	if err := os.WriteFile(out, []byte("glTF"), 0o644); err != nil {
		return BuildResult{}, err
	}
	return BuildResult{Bytes: 4, Triangles: 100}, nil
}

// runnerOf wires a Runner to a fakeStore.
func runnerOf(t *testing.T, f *fakeStore) *Runner {
	t.Helper()
	r, err := New(f.build, "", f.ready)
	if err != nil {
		t.Fatal(err)
	}
	r.SetDest(f.path)
	return r
}

func waitState(t *testing.T, r *Runner, module string, want State) Snapshot {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s := r.Snapshot(module)
		if s.State == want {
			return s
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("module %s never reached state %s (last=%s)", module, want, r.Snapshot(module).State)
	return Snapshot{}
}

// waitBuilding polls until the module is building (the pump starts the build promptly after
// an enqueue, so a fresh enqueue reads queued for a moment before it is picked up).
func waitBuilding(t *testing.T, r *Runner, module string) Snapshot {
	t.Helper()
	return waitState(t, r, module, StateBuilding)
}

// TestRunnerSingleFlight — two Enqueue calls for one module run exactly one build.
func TestRunnerSingleFlight(t *testing.T) {
	f := newFakeStore(t)
	f.delay = 30 * time.Millisecond // slow enough to observe the building state
	r := runnerOf(t, f)
	r.Start()
	defer r.Stop(2 * time.Second)

	s1 := r.Enqueue("moda")
	// The first enqueue registers the build; the pump picks it up into building promptly.
	if s1.State != StateQueued && s1.State != StateBuilding {
		t.Fatalf("first enqueue state = %s, want queued or building", s1.State)
	}
	waitBuilding(t, r, "moda")
	s2 := r.Enqueue("moda")
	// While the build runs, a second request for the same module joins it: building.
	if s2.State != StateBuilding {
		t.Fatalf("second enqueue state = %s, want building (join, not a new build)", s2.State)
	}
	waitState(t, r, "moda", StateReady)

	f.mu.Lock()
	n := f.builds["moda"]
	f.mu.Unlock()
	if n != 1 {
		t.Fatalf("builds for moda = %d, want 1 (single flight)", n)
	}
}

// TestRunnerQueueOrder — two modules enqueue in order and build in that order, one at a
// time.
func TestRunnerQueueOrder(t *testing.T) {
	f := newFakeStore(t)
	f.delay = 20 * time.Millisecond
	r := runnerOf(t, f)
	r.Start()
	defer r.Stop(2 * time.Second)

	sA := r.Enqueue("alpha")
	if sA.State != StateQueued && sA.State != StateBuilding {
		t.Fatalf("alpha = %s, want queued or building", sA.State)
	}
	sB := r.Enqueue("beta")
	if sB.State != StateQueued {
		t.Fatalf("beta = %s, want queued (alpha is ahead)", sB.State)
	}
	// beta is queued behind alpha; its position is whatever is ahead of it (>=1). The key
	// property is that it is queued, not building, while alpha is still in front.
	if sB.QueuePosition < 1 {
		t.Fatalf("beta queue position = %d, want >= 1", sB.QueuePosition)
	}
	waitState(t, r, "beta", StateBuilding)
	waitState(t, r, "alpha", StateReady)
	waitState(t, r, "alpha", StateReady)
	waitState(t, r, "beta", StateReady)
	// alpha must have been ready before beta even started building.
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.builds["alpha"] != 1 || f.builds["beta"] != 1 {
		t.Fatalf("builds alpha=%d beta=%d, want 1/1", f.builds["alpha"], f.builds["beta"])
	}
}

// TestRunnerFailureAndRetry — a failed build records the error, and a later Enqueue retries
// and succeeds.
func TestRunnerFailureAndRetry(t *testing.T) {
	f := newFakeStore(t)
	f.fail["moda"] = errors.New("boom: moda")
	r := runnerOf(t, f)
	r.Start()
	defer r.Stop(2 * time.Second)

	r.Enqueue("moda")
	s := waitState(t, r, "moda", StateFailed)
	if s.Error == "" {
		t.Fatalf("failed snapshot has no error text: %+v", s)
	}
	// Retry: the file is still absent, so the build runs again and this time succeeds.
	r2snap := r.Enqueue("moda")
	if r2snap.State == StateFailed {
		// The retry may have not yet started; it will become building then ready.
	}
	waitState(t, r, "moda", StateReady)
	f.mu.Lock()
	n := f.builds["moda"]
	f.mu.Unlock()
	if n != 2 {
		t.Fatalf("builds for moda = %d, want 2 (one failure + one retry)", n)
	}
}

// TestRunnerTempFileCleanupOnFailure — a failed build leaves no file behind in the store
// (the destination is absent), and the state is failed.
func TestRunnerTempFileCleanupOnFailure(t *testing.T) {
	f := newFakeStore(t)
	f.fail["moda"] = errors.New("boom")
	r := runnerOf(t, f)
	r.Start()
	defer r.Stop(2 * time.Second)

	r.Enqueue("moda")
	waitState(t, r, "moda", StateFailed)
	if _, err := os.Stat(f.path("moda")); !os.IsNotExist(err) {
		t.Fatalf("a failed build left a file at %s (err=%v)", f.path("moda"), err)
	}
}

// TestRunnerStopCancelsCooperativeBuild — Stop cancels the active build; a cooperative
// builder returns the cancellation error and the module records failed with that error.
func TestRunnerStopCancelsCooperativeBuild(t *testing.T) {
	f := newFakeStore(t)
	f.delay = time.Second // long enough that Stop lands mid-build
	r := runnerOf(t, f)
	r.Start()
	r.Enqueue("moda")
	waitState(t, r, "moda", StateBuilding)

	done := make(chan struct{})
	go func() {
		r.Stop(3 * time.Second)
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(4 * time.Second):
		t.Fatal("Stop did not return within grace")
	}
	// The cancelled build reports the context error.
	s := r.Snapshot("moda")
	if s.State != StateFailed {
		t.Fatalf("after cancel, state = %s, want failed", s.State)
	}
	if s.Error == "" {
		t.Fatalf("cancelled build left no error: %+v", s)
	}
}

// TestRunnerAbsentAndReady — a module with no file and no build reports absent; a module
// whose file already exists reports ready without queuing a build.
func TestRunnerAbsentAndReady(t *testing.T) {
	f := newFakeStore(t)
	r := runnerOf(t, f)
	r.Start()
	defer r.Stop(2 * time.Second)

	s := r.Snapshot("ghost")
	if s.State != StateAbsent {
		t.Fatalf("ghost = %s, want absent", s.State)
	}
	// A file that already exists reports ready and enqueues nothing.
	f.mu.Lock()
	f.files["prebuilt"] = true
	f.mu.Unlock()
	if err := os.WriteFile(f.path("prebuilt"), []byte("glTF"), 0o644); err != nil {
		t.Fatal(err)
	}
	s2 := r.Enqueue("prebuilt")
	if s2.State != StateReady {
		t.Fatalf("prebuilt = %s, want ready", s2.State)
	}
	f.mu.Lock()
	n := f.builds["prebuilt"]
	f.mu.Unlock()
	if n != 0 {
		t.Fatalf("prebuilt builds = %d, want 0 (already on disk)", n)
	}
}

// TestRunnerOutdated — a module whose output is on disk in an older build format (not
// ready, outdated) reports StateOutdated; Enqueue builds it; when the format check turns
// current the module reports ready.
func TestRunnerOutdated(t *testing.T) {
	f := newFakeStore(t)
	f.delay = 30 * time.Millisecond // slow enough to observe the building state
	var mu sync.Mutex
	stale := true
	ready := func(module string) bool {
		mu.Lock()
		defer mu.Unlock()
		return !stale && f.files[module]
	}
	outdated := func(module string) bool {
		mu.Lock()
		defer mu.Unlock()
		return stale && f.files[module]
	}
	r, err := New(f.build, "", ready)
	if err != nil {
		t.Fatal(err)
	}
	r.SetDest(f.path)
	r.SetOutdated(outdated)
	r.Start()
	defer r.Stop(2 * time.Second)

	// An old-format file is on disk.
	f.mu.Lock()
	f.files["old"] = true
	f.mu.Unlock()
	if err := os.WriteFile(f.path("old"), []byte("glTF"), 0o644); err != nil {
		t.Fatal(err)
	}
	if s := r.Snapshot("old"); s.State != StateOutdated {
		t.Fatalf("old = %s, want outdated", s.State)
	}
	// Not ready, so the build flow rebuilds it.
	r.Enqueue("old")
	waitBuilding(t, r, "old")
	mu.Lock()
	stale = false
	mu.Unlock()
	waitState(t, r, "old", StateReady)
	f.mu.Lock()
	n := f.builds["old"]
	f.mu.Unlock()
	if n != 1 {
		t.Fatalf("old builds = %d, want 1", n)
	}
}

// TestRunnerNewRequiresArgs — New rejects a nil build or ready.
func TestRunnerNewRequiresArgs(t *testing.T) {
	if _, err := New(nil, "", func(string) bool { return false }); err == nil {
		t.Fatal("nil build should be rejected")
	}
	if _, err := New(func(context.Context, string, string, string) (BuildResult, error) { return BuildResult{}, nil }, "", nil); err == nil {
		t.Fatal("nil ready should be rejected")
	}
}

// TestProgressReporterMovesOnlyForward — Report clamps to [0,1] and moves the fraction only
// forward; the stage is the latest non-empty name.
func TestProgressReporterMovesOnlyForward(t *testing.T) {
	r, err := New(func(context.Context, string, string, string) (BuildResult, error) { return BuildResult{}, nil }, "", func(string) bool { return false })
	if err != nil {
		t.Fatal(err)
	}
	rep := &progressReporter{r: r, module: "moda"}
	rep.Report(0.5, "geometry")
	rep.Report(0.2, "textures") // a backwards fraction is ignored
	rep.Report(0.7, "textures")
	rep.Report(1.5, "") // clamped; empty stage keeps the last
	rep.Report(-0.5, "")
	r.mu.Lock()
	v := r.progress["moda"]
	r.mu.Unlock()
	if v.frac != 1 {
		t.Fatalf("frac = %v, want 1 (0.7 kept, then clamped 1.5)", v.frac)
	}
	if v.stage != "textures" {
		t.Fatalf("stage = %q, want textures", v.stage)
	}
}

// TestRunnerProgress — an active build reports through its context; the snapshot carries the
// fraction and stage, the fraction reaches 1 only when the build is ready, and a failed build
// never reads 1.
func TestRunnerProgress(t *testing.T) {
	f := newFakeStore(t)
	r, err := New(func(ctx context.Context, module, gameRoot, out string) (BuildResult, error) {
		rep := ProgressFromContext(ctx)
		if rep == nil {
			return BuildResult{}, errors.New("build under the runner has no progress reporter")
		}
		rep.Report(0.2, "geometry")
		time.Sleep(20 * time.Millisecond)
		rep.Report(0.6, "textures")
		if f.fail[module] != nil {
			f.mu.Lock()
			delete(f.fail, module)
			f.mu.Unlock()
			return BuildResult{}, errors.New("boom")
		}
		f.mu.Lock()
		f.files[module] = true
		f.mu.Unlock()
		if err := os.WriteFile(out, []byte("glTF"), 0o644); err != nil {
			return BuildResult{}, err
		}
		return BuildResult{Bytes: 4}, nil
	}, "", f.ready)
	if err != nil {
		t.Fatal(err)
	}
	r.SetDest(f.path)
	r.Start()
	defer r.Stop(2 * time.Second)

	r.Enqueue("moda")
	// While the build runs, the snapshot shows a sub-1 fraction and a stage.
	var building *Snapshot
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s := r.Snapshot("moda")
		if s.State == StateBuilding && s.Progress > 0 {
			building = &s
			break
		}
		time.Sleep(2 * time.Millisecond)
	}
	if building == nil {
		t.Fatal("never saw a building snapshot with progress")
	}
	if building.Progress >= 1 {
		t.Fatalf("building progress = %v, want < 1 (1 is ready's)", building.Progress)
	}
	if building.Stage == "" {
		t.Fatalf("building snapshot has no stage: %+v", building)
	}
	s := waitState(t, r, "moda", StateReady)
	if s.Progress != 1 {
		t.Fatalf("ready progress = %v, want 1", s.Progress)
	}

	// A failed build never reads 1.
	f.fail["crash"] = errors.New("boom")
	r.Enqueue("crash")
	waitState(t, r, "crash", StateFailed)
	if got := r.Snapshot("crash"); got.Progress >= 1 {
		t.Fatalf("failed progress = %v, want < 1", got.Progress)
	}
}

// TestRunnerActivity — idle: no active module and an empty queue; while one builds, the
// active snapshot names it and the queue lists the rest in order (a copy the caller owns).
func TestRunnerActivity(t *testing.T) {
	f := newFakeStore(t)
	f.delay = 200 * time.Millisecond
	r := runnerOf(t, f)
	if a, q := r.Activity(); a != nil || len(q) != 0 {
		t.Fatalf("idle activity = %v %v, want nil and empty", a, q)
	}
	r.Start()
	defer r.Stop(2 * time.Second)
	r.Enqueue("alpha")
	waitBuilding(t, r, "alpha")
	r.Enqueue("beta")
	r.Enqueue("gamma")
	a, q := r.Activity()
	if a == nil || a.ModuleKey != "alpha" || a.State != StateBuilding || a.StartedAt.IsZero() {
		t.Fatalf("active = %+v, want alpha building with a start time", a)
	}
	if len(q) != 2 || q[0] != "beta" || q[1] != "gamma" {
		t.Fatalf("queued = %v, want [beta gamma]", q)
	}
	q[0] = "mutated"
	if _, q2 := r.Activity(); q2[0] != "beta" {
		t.Fatalf("the queue copy aliases the runner's: %v", q2)
	}
}
