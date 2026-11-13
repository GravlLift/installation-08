// Package meshjobs runs map mesh builds for the server, one at a time. It owns the state
// of each map module (absent, queued, building, ready, failed), serializes builds process
// wide, and hands out an immutable state snapshot for a module key at any moment.
//
// The build itself is injected (the Builder) so tests drive the runner with a fake that
// merely waits and writes a file. The runner never reads the game installation: the only
// things that know about disk are the callbacks the server wires to the store (whether a
// mesh is already present, and where to write the next one).
package meshjobs

import (
	"context"
	"fmt"
	"sync"
	"time"
)

// JobWeapons is the module key the runner uses for the single weapon-library build. It shares
// the runner's queue with the map builds, so it never runs beside one: the library is one job.
const JobWeapons = "weapons"

// JobFirstPerson is the module key the runner uses for the single first-person library build.
// Like JobWeapons it shares the runner's queue with the map builds, so at most one heavy
// build (map, weapons, or first person) runs at a time.
const JobFirstPerson = "first-person"

// JobWeaponIcons is the module key the runner uses for the single weapon-icon build (the
// PNG set and its index.json). Like the other library jobs it shares the runner's queue
// with the map builds, so at most one heavy build runs at a time.
const JobWeaponIcons = "weapon-icons"

// JobHudIcons is the module key the runner uses for the single HUD equipment/grenade icon
// build (the 15 HUD PNGs and their index.json). It is queued after the weapon-icon job and
// shares the runner's queue with the map builds, like the other library jobs.
const JobHudIcons = "hud-icons"

// JobRanks is the module key the runner uses for the single rank badge build (the 31 CSR
// badge PNGs decoded from the game install). Like the other icon jobs it shares the
// runner's queue with the map builds, so at most one heavy build runs at a time.
const JobRanks = "ranks"

// JobSpartanPieces is the module key the runner uses for the single Spartan armor
// piece library build (the piece and attachment GLBs, the shared textures, the
// optional coating table, and the index.json). Like JobFirstPerson it shares the
// runner's queue with the map builds, so at most one heavy build runs at a time.
const JobSpartanPieces = "spartan-pieces"

// State is one module's build state as seen through the runner.
type State string

// The states a module can be in. Ready is re-derived from the store at read time, so a
// module whose file appears later (built by another process) reports ready without any
// state transition here.
const (
	StateAbsent   State = "absent"
	StateQueued   State = "queued"
	StateBuilding State = "building"
	StateReady    State = "ready"
	StateFailed   State = "failed"
)

// BuildResult summarizes one completed build (the byte count and triangle count of the
// written GLB). It is stored with the module so a state snapshot can report it.
type BuildResult struct {
	Bytes     int64
	Triangles int
}

// Builder builds one map module's mesh to the file named by out. ctx is the job's context:
// when the runner is stopped it is cancelled, and a cooperative builder stops and reports
// the cancellation error. A non-cooperative builder (the real chain today) ignores it; the
// runner then waits at most a short grace period before giving up.
type Builder func(ctx context.Context, module, gameRoot, out string) (BuildResult, error)

// Snapshot is an immutable view of one module's state, what the server routes hand out.
// Fields that do not apply for the state are left at their zero value (an omitted field in
// the JSON response).
type Snapshot struct {
	State         State
	ModuleKey     string
	Error         string
	QueuePosition int
	StartedAt     time.Time
	ElapsedMs     int64
	Bytes         int64
	Triangles     int
}

// Ready reports whether the state is one in which the mesh file is present and servable.
func (s Snapshot) Ready() bool { return s.State == StateReady }

// Runner serializes map builds and tracks each module's state. It is process wide: one
// build runs at a time, the rest queue in arrival order, and a request for a module that is
// already queued or building joins it.
type Runner struct {
	build Builder
	// ready says whether the mesh for module is already on disk (the server wires it to
	// store.MeshPath + a file stat).
	ready func(module string) bool
	// dest maps a module key to its store file path, the build's output file (the server
	// wires it to store.MeshPath). Nil (tests that never build) falls back to a name.
	dest     func(module string) string
	gameRoot string

	mu          sync.Mutex
	queue       []string // modules waiting to build, in arrival order
	active      string   // the module being built, or ""
	failed      map[string]string
	started     map[string]time.Time
	result      map[string]BuildResult
	cancel      context.CancelFunc // the active build's cancel, or nil
	pumpStarted bool
	done        chan struct{}
	kick        chan struct{} // signals the pump that work may be waiting
	stopOnce    sync.Once
}

// New builds a Runner. build and ready must be non-nil; gameRoot is the deploy root passed
// to every build (empty auto-detects).
func New(build Builder, gameRoot string, ready func(string) bool) (*Runner, error) {
	if build == nil {
		return nil, fmt.Errorf("meshjobs: build is required")
	}
	if ready == nil {
		return nil, fmt.Errorf("meshjobs: ready is required")
	}
	return &Runner{
		build:    build,
		gameRoot: gameRoot,
		ready:    ready,
		failed:   make(map[string]string),
		started:  make(map[string]time.Time),
		result:   make(map[string]BuildResult),
		done:     make(chan struct{}),
		kick:     make(chan struct{}, 1),
	}, nil
}

// SetDest wires the store's mesh path in, so the runner writes to the real file. The
// server calls it before Start.
func (r *Runner) SetDest(f func(string) string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.dest = f
}

// Start launches the runner's pump: the single goroutine that builds one module at a time.
// It returns immediately. It is safe to call once at startup; a second call is a no-op.
func (r *Runner) Start() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.pumpStarted {
		return
	}
	r.pumpStarted = true
	go r.pump()
}

// Enqueue asks for a build of module and returns a snapshot as of the request. If the
// module's mesh is already on disk it answers ready without queuing. If a build of the
// module is already running or queued it joins it (no second build). Otherwise it appends
// the module to the queue and wakes the pump. The returned snapshot is the state immediately
// after the request is registered: ready, building, or queued (the pump starts the build
// promptly; a caller watching progress re-queries Snapshot).
func (r *Runner) Enqueue(module string) Snapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.ready(module) {
		return r.snapshotLocked(module)
	}
	if r.active == module {
		return r.snapshotLocked(module) // join the running build
	}
	for _, m := range r.queue {
		if m == module {
			return r.snapshotLocked(module) // join the queued build
		}
	}
	r.queue = append(r.queue, module)
	r.kickPumpLocked()
	return r.snapshotLocked(module)
}

// kickPumpLocked wakes the pump. The lock must be held (the kick is a non-blocking,
// buffered-by-one channel, so it never blocks the sender).
func (r *Runner) kickPumpLocked() {
	select {
	case r.kick <- struct{}{}:
	default:
	}
}

// pump builds modules one at a time, in arrival order, until the runner is stopped. It is
// the only goroutine that ever calls the Builder. It idles on the kick and done channels,
// so an Enqueue is picked up promptly without a poll interval.
func (r *Runner) pump() {
	for {
		r.mu.Lock()
		if len(r.queue) > 0 && r.active == "" {
			module := r.queue[0]
			r.queue = r.queue[1:]
			r.active = module
			r.started[module] = time.Now()
			delete(r.failed, module)
			// Drain a stray kick so we do not spin: it was for the job we just took.
			select {
			case <-r.kick:
			default:
			}
			r.mu.Unlock()
			r.runJob(module)
			r.mu.Lock()
			r.active = ""
			select {
			case <-r.kick: // a module queued during the build: loop back and take it
			default:
			}
			r.mu.Unlock()
			continue
		}
		r.mu.Unlock()
		select {
		case <-r.done:
			return
		case <-r.kick:
		}
	}
}

// runJob builds one module. The build writes the mesh to the destination path (it uses a
// temp file + rename, so a half-written file is never served) and the runner records the
// outcome. A Stop cancels the build's context.
func (r *Runner) runJob(module string) {
	ctx, cancel := context.WithCancel(context.Background())
	r.mu.Lock()
	r.cancel = cancel
	r.mu.Unlock()
	defer func() {
		cancel()
		r.mu.Lock()
		r.cancel = nil
		r.mu.Unlock()
	}()

	out := r.outFor(module)
	res, err := r.build(ctx, module, r.gameRoot, out)
	r.mu.Lock()
	if err == nil {
		r.result[module] = res
	} else {
		r.failed[module] = err.Error()
	}
	r.mu.Unlock()
}

// outFor is the destination file for module's mesh.
func (r *Runner) outFor(module string) string {
	r.mu.Lock()
	f := r.dest
	r.mu.Unlock()
	if f == nil {
		return module + ".glb"
	}
	return f(module)
}

// Snapshot returns the current state of module.
func (r *Runner) Snapshot(module string) Snapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.snapshotLocked(module)
}

// snapshotLocked is Snapshot with the lock already held. It re-derives ready from the
// store first, so a file built out-of-band reports ready.
func (r *Runner) snapshotLocked(module string) Snapshot {
	if r.ready(module) {
		s := Snapshot{State: StateReady, ModuleKey: module}
		if res, ok := r.result[module]; ok {
			s.Bytes = res.Bytes
			s.Triangles = res.Triangles
		}
		return s
	}
	if r.active == module {
		st := r.started[module]
		elapsed := int64(0)
		if !st.IsZero() {
			elapsed = time.Since(st).Milliseconds()
		}
		return Snapshot{State: StateBuilding, ModuleKey: module, StartedAt: st, ElapsedMs: elapsed}
	}
	if pos, ok := r.queuePosition(module); ok {
		return Snapshot{State: StateQueued, ModuleKey: module, QueuePosition: pos}
	}
	if errText, ok := r.failed[module]; ok {
		return Snapshot{State: StateFailed, ModuleKey: module, Error: errText}
	}
	return Snapshot{State: StateAbsent, ModuleKey: module}
}

// queuePosition is module's 1-based position in the queue, and whether it is queued.
func (r *Runner) queuePosition(module string) (int, bool) {
	for i, m := range r.queue {
		if m == module {
			return i + 1, true
		}
	}
	return 0, false
}

// Stop cancels the active build's context and waits for the pump to finish. It blocks at
// most grace for a non-cooperative build (one that ignores the cancelled context) and then
// returns; a cooperative build returns as soon as it notices. Stop is idempotent.
func (r *Runner) Stop(grace time.Duration) {
	r.stopOnce.Do(func() { close(r.done) })
	r.mu.Lock()
	if r.active != "" && r.cancel != nil {
		r.cancel()
	}
	r.mu.Unlock()
	deadline := time.Now().Add(grace)
	for {
		r.mu.Lock()
		idle := r.active == ""
		r.mu.Unlock()
		if idle || time.Now().After(deadline) {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
}
