// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

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
	"strings"
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

// JobBackdrop is the module key the runner uses for the single home backdrop build (the
// ring space scene decoded from the game install). Like the other icon jobs it shares the
// runner's queue with the map builds, so at most one heavy build runs at a time.
const JobBackdrop = "backdrop"

// JobAnnouncer is the module key the runner uses for the single announcer sound build (the
// announcer's voice lines decoded from the game install into the replay sound folder, with
// their announcer.json manifest). Like the icon jobs it shares the runner's queue with the map
// builds, so at most one heavy build runs at a time.
const JobAnnouncer = "announcer"

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
	StateAbsent    State = "absent"
	StateQueued    State = "queued"
	StateBuilding  State = "building"
	StateReady     State = "ready"
	StateFailed    State = "failed"
	StateCancelled State = "cancelled"
	// StateOutdated: the output is on disk but in an older build format (the version
	// written with it does not match the current one): the normal build flow rebuilds it
	// in place, and the viewer reads it as an update, not a first build.
	StateOutdated State = "outdated"
)

// BuildResult summarizes one completed build (the byte count and triangle count of the
// written GLB). It is stored with the module so a state snapshot can report it.
type BuildResult struct {
	Bytes     int64
	Triangles int
}

// Quality is a map mesh's texture quality. Standard reads the map textures at the standard
// caps (today's output, byte-identical); high reads them at double the side. A map and a Forge
// variant each carry their own quality: the two are separate builds with separate files.
type Quality string

// The two qualities a mesh build can be requested in.
const (
	QualityStandard Quality = "standard"
	QualityHigh     Quality = "high"
)

// qualitySuffix is appended to a module key (and, with .glb, to a map file name) for a high
// build, so a high build of a module is a separate job and file from its standard build.
const qualitySuffix = ".high"

// ParseQuality validates a quality name from a query parameter or a flag. An empty value is
// standard (the default); any other name is refused (ok false).
func ParseQuality(s string) (q Quality, ok bool) {
	switch s {
	case "", string(QualityStandard):
		return QualityStandard, true
	case string(QualityHigh):
		return QualityHigh, true
	default:
		return QualityStandard, false
	}
}

// JobKey is the runner's key for a module's build of quality q: the module key unchanged for
// standard, the key with the high suffix for high (a distinct job from standard).
func JobKey(module string, q Quality) string {
	if q == QualityHigh {
		return module + qualitySuffix
	}
	return module
}

// SplitQuality inverts JobKey: the high suffix names the high quality, its absence the standard.
func SplitQuality(key string) (module string, q Quality) {
	if m, ok := strings.CutSuffix(key, qualitySuffix); ok {
		return m, QualityHigh
	}
	return key, QualityStandard
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
	// Progress is the active build's fraction done, 0..1, reported by the build through the
	// context reporter. It is zero until the build reports (a queued build, a build that has
	// not started, and a build whose chain reports no progress all read 0), and it reaches 1
	// only when the file is written and the build has succeeded (the runner sets it on success).
	Progress float64
	// Stage is the build step the build is in ("geometry", "lighting", "writing", "textures"),
	// as named by the build; empty when none is reported.
	Stage string
}

// Ready reports whether the state is one in which the mesh file is present and servable.
func (s Snapshot) Ready() bool { return s.State == StateReady }

// progressInfo is one module's build progress as the build reports it: a fraction 0..1 and
// the stage it is in. It is kept per module so a Snapshot can carry it while the build runs.
type progressInfo struct {
	frac  float64
	stage string
}

// ProgressReporter is what an active build's context carries so the build can report its
// progress as it works. The build reads it from its context with ProgressFromContext and calls
// Report with a fraction 0..1 and the stage it is in. The runner stores it (moving only
// forward) and exposes it in the module's snapshot; it sets the fraction to 1 when the build
// succeeds, so progress reaches 1 only when the file is written and the state is ready.
type ProgressReporter interface {
	Report(frac float64, stage string)
}

// progressKey is the context key the runner uses to carry a build's ProgressReporter.
type progressKey struct{}

// ProgressFromContext returns the ProgressReporter of the build that runs under ctx, or nil
// when ctx is not a runner build (the standalone CLI, tests that build out of band). A nil
// result means the build should not report progress (there is no one to read it).
func ProgressFromContext(ctx context.Context) ProgressReporter {
	rep, _ := ctx.Value(progressKey{}).(ProgressReporter)
	return rep
}

// progressReporter is the runner's ProgressReporter for one active build. Report clamps the
// fraction to [0,1] and moves it only forward (a stage boundary never reports below the last
// value seen); the stage is overwritten by the latest non-empty name.
type progressReporter struct {
	r      *Runner
	module string
}

func (p *progressReporter) Report(frac float64, stage string) {
	if frac < 0 {
		frac = 0
	}
	if frac > 1 {
		frac = 1
	}
	p.r.mu.Lock()
	defer p.r.mu.Unlock()
	v := p.r.progress[p.module]
	if frac > v.frac {
		v.frac = frac
	}
	if stage != "" {
		v.stage = stage
	}
	p.r.progress[p.module] = v
}

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
	dest func(module string) string
	// outdated says whether the module's output is on disk in an older build format (the
	// server wires it to the store's build-format check). Nil falls back to no outdated
	// state (tests that do not check formats).
	outdated func(module string) bool
	gameRoot string

	mu          sync.Mutex
	queue       []string // modules waiting to build, in arrival order
	active      string   // the module being built, or ""
	failed      map[string]string
	cancelled   map[string]bool
	cancelling  bool
	started     map[string]time.Time
	result      map[string]BuildResult
	progress    map[string]progressInfo // module -> build progress (fraction + stage)
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
		build:     build,
		gameRoot:  gameRoot,
		ready:     ready,
		failed:    make(map[string]string),
		cancelled: make(map[string]bool),
		started:   make(map[string]time.Time),
		result:    make(map[string]BuildResult),
		progress:  make(map[string]progressInfo),
		done:      make(chan struct{}),
		kick:      make(chan struct{}, 1),
	}, nil
}

// SetDest wires the store's mesh path in, so the runner writes to the real file. The
// server calls it before Start.
func (r *Runner) SetDest(f func(string) string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.dest = f
}

// SetOutdated wires the build-format check in, so a module whose output is on disk in an
// older build format reports StateOutdated (it is not ready, so Enqueue builds it; the
// server calls it before Start).
func (r *Runner) SetOutdated(f func(string) bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.outdated = f
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
	delete(r.cancelled, module)
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
			ctx, cancel := context.WithCancel(context.Background())
			r.cancel = cancel
			r.cancelling = false
			r.started[module] = time.Now()
			delete(r.failed, module)
			// Fresh progress for this build: it starts at 0 and only moves forward, reaching 1
			// solely when the build succeeds (runJob). The build reports through the context.
			r.progress[module] = progressInfo{}
			ctx = context.WithValue(ctx, progressKey{}, &progressReporter{r: r, module: module})
			// Drain a stray kick so we do not spin: it was for the job we just took.
			select {
			case <-r.kick:
			default:
			}
			r.mu.Unlock()
			r.runJob(ctx, module)
			r.mu.Lock()
			cancel()
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
func (r *Runner) runJob(ctx context.Context, module string) {
	out := r.outFor(module)
	res, err := r.build(ctx, module, r.gameRoot, out)
	r.mu.Lock()
	if r.cancelling {
		r.cancelled[module] = true
	} else if err == nil {
		r.result[module] = res
		// Progress reaches 1 only now: the file is written and the build succeeded.
		r.progress[module] = progressInfo{frac: 1}
	} else {
		r.failed[module] = err.Error()
	}
	r.active = ""
	r.cancel = nil
	r.mu.Unlock()
}

// Cancel cancels the active build for module, if one is running.
func (r *Runner) Cancel(module string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.active != module || r.cancel == nil || r.cancelling {
		return false
	}
	r.cancelling = true
	r.cancel()
	return true
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

// Activity returns what the runner is doing right now: the active module's snapshot (nil
// when nothing builds) and the queued module keys in order, copied under the lock so the
// caller can read them freely.
func (r *Runner) Activity() (*Snapshot, []string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	queued := append([]string(nil), r.queue...)
	if r.active == "" {
		return nil, queued
	}
	st := r.started[r.active]
	p := r.progress[r.active]
	s := Snapshot{State: StateBuilding, ModuleKey: r.active, StartedAt: st, Progress: p.frac, Stage: p.stage}
	if !st.IsZero() {
		s.ElapsedMs = time.Since(st).Milliseconds()
	}
	return &s, queued
}

// snapshotLocked is Snapshot with the lock already held. It re-derives ready from the
// store first, so a file built out-of-band reports ready; a file present in an older
// build format reports StateOutdated (the ready check covers the format, so ready is
// false here).
func (r *Runner) snapshotLocked(module string) Snapshot {
	// A build of this module in progress (or queued) wins: while it runs the old file is still
	// on disk, so the outdated check would otherwise mask the building/queued state.
	if r.active == module {
		st := r.started[module]
		elapsed := int64(0)
		if !st.IsZero() {
			elapsed = time.Since(st).Milliseconds()
		}
		p := r.progress[module]
		return Snapshot{State: StateBuilding, ModuleKey: module, StartedAt: st, ElapsedMs: elapsed,
			Progress: p.frac, Stage: p.stage}
	}
	if pos, ok := r.queuePosition(module); ok {
		return Snapshot{State: StateQueued, ModuleKey: module, QueuePosition: pos}
	}
	if r.outdated != nil && r.outdated(module) {
		return Snapshot{State: StateOutdated, ModuleKey: module}
	}
	if r.ready(module) {
		s := Snapshot{State: StateReady, ModuleKey: module}
		if res, ok := r.result[module]; ok {
			s.Bytes = res.Bytes
			s.Triangles = res.Triangles
		}
		// A build that just finished in this process reports its completed fraction (1); a
		// module ready from disk without a build here has no progress to report.
		if p := r.progress[module]; p.frac > 0 {
			s.Progress = p.frac
		}
		return s
	}
	if r.cancelled[module] {
		return Snapshot{State: StateCancelled, ModuleKey: module}
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
