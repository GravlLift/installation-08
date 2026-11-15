package main

// serve_coatings_setup.go — the in-app coatings setup: POST /api/coatings/setup starts the
// server's one setup job (internal/ekursetup: download and verify Ekur's dumper, dump the
// game's coating data, validate it, swap it into <data>/ekur), GET /api/coatings/setup/state
// reports its stage, and a successful run queues the coating library rebuilds the way the
// startup does when it finds a new export. The job runs only on explicit request, never at
// startup. Like every state-changing route it accepts loopback origins only, and the
// read-only mode refuses it (readOnlyHandler refuses every POST).
//
// The state never carries a path or an environment value: the stage word and, on failure,
// the setup's own message.

import (
	"context"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/ekursetup"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// The setup states besides the ekursetup stages (downloading, verifying, dumping,
// validating, queuing): idle before any run in this process, ready after a successful one,
// failed after a failed one.
const (
	setupIdle   = "idle"
	setupReady  = "ready"
	setupFailed = "failed"
)

// coatingsSetupState is the body of GET /api/coatings/setup/state and of the 202 that
// starts a run.
type coatingsSetupState struct {
	State string `json:"state"`
	Error string `json:"error,omitempty"`
}

// coatingsSetupJob is the server's single setup job: one run at a time, its latest state.
type coatingsSetupJob struct {
	mu     sync.Mutex
	active bool
	state  coatingsSetupState
	// game is the --game deploy root ("" auto-detects, as the other one-time builds do).
	game string
	// run performs the setup itself, reporting each stage; nil runs ekursetup.Run against
	// the server's data directory and game root. Tests replace it.
	run func(ctx context.Context, progress func(ekursetup.Stage)) error
	// requeuePoll is how often a coating library build that was running when the export
	// changed is checked for completion (0: two seconds).
	requeuePoll time.Duration
}

// handleCoatingsSetup answers POST /api/coatings/setup: it starts the setup job and answers
// 202 with its first state, or 409 while a run is in progress. A non-loopback Origin is
// refused with 403; a server without a build queue answers 503 (the rebuilds need it).
func (h serverHandlers) handleCoatingsSetup(w http.ResponseWriter, r *http.Request) {
	if !originAllowed(r) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin_not_allowed"})
		return
	}
	if h.jobs == nil || h.coatingsSetup == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"error": "builds_unavailable"})
		return
	}
	j := h.coatingsSetup
	j.mu.Lock()
	if j.active {
		state := j.state
		j.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]any{"error": "setup_in_progress", "state": state.State})
		return
	}
	j.active = true
	j.state = coatingsSetupState{State: string(ekursetup.StageDownloading)}
	state := j.state
	j.mu.Unlock()
	go h.runCoatingsSetup()
	writeJSON(w, http.StatusAccepted, state)
}

// handleCoatingsSetupState answers GET /api/coatings/setup/state with the setup job's
// state (idle when no run happened in this process).
func (h serverHandlers) handleCoatingsSetupState(w http.ResponseWriter, r *http.Request) {
	if h.coatingsSetup == nil {
		writeJSON(w, http.StatusOK, coatingsSetupState{State: setupIdle})
		return
	}
	h.coatingsSetup.mu.Lock()
	state := h.coatingsSetup.state
	h.coatingsSetup.mu.Unlock()
	if state.State == "" {
		state.State = setupIdle
	}
	writeJSON(w, http.StatusOK, state)
}

// runCoatingsSetup is the job body: the setup, then (on success) the coating library
// rebuilds, then the final state. One log line per stage and one for the outcome; the
// dumper's own output goes to the run log in <data>/tools/ekur.
func (h serverHandlers) runCoatingsSetup() {
	j := h.coatingsSetup
	progress := func(s ekursetup.Stage) {
		slog.Info("coatings setup", "stage", s)
		j.mu.Lock()
		j.state = coatingsSetupState{State: string(s)}
		j.mu.Unlock()
	}
	run := j.run
	if run == nil {
		run = h.defaultCoatingsSetup
	}
	err := run(context.Background(), progress)
	if err == nil {
		progress(ekursetup.StageQueuing)
		h.queueCoatingRebuilds()
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if err != nil {
		slog.Error("coatings setup failed", "err", err)
		j.state = coatingsSetupState{State: setupFailed, Error: err.Error()}
	} else {
		slog.Info("coatings setup done: Ekur export in place, coating library rebuilds queued")
		j.state = coatingsSetupState{State: setupReady}
	}
	j.active = false
}

// defaultCoatingsSetup runs the real setup: the override check first (the variable wins
// over <data>/ekur, so a dump there would change nothing), then the game install the other
// one-time builds use, then ekursetup.Run.
func (h serverHandlers) defaultCoatingsSetup(ctx context.Context, progress func(ekursetup.Stage)) error {
	if _, override := spartanpieces.EkurCandidate(h.root.Dir()); override {
		return ekursetup.ErrOverride
	}
	game, err := ekursetup.ResolveGameRoot(h.coatingsSetup.game)
	if err != nil {
		return err
	}
	_, err = ekursetup.Run(ctx, ekursetup.Options{DataDir: h.root.Dir(), GameRoot: game, Progress: progress})
	return err
}

// queueCoatingRebuilds queues the three coating libraries after a new export landed, the
// way the startup does when it finds one: the cached export stamp is dropped, a stale
// library is moved aside, and the library is enqueued (the runner skips one that is ready
// and joins one already queued). A library whose build is running right now started on the
// old export: it is left to finish and rebuilt right after (requeueAfterBuild), never moved
// aside under a running build.
func (h serverHandlers) queueCoatingRebuilds() {
	forgetEkurStamps()
	dataDir := h.root.Dir()
	for _, module := range coatingLibraryModules {
		if h.jobs.Snapshot(module).State == meshjobs.StateBuilding {
			go h.requeueAfterBuild(module)
			continue
		}
		moveCoatingLibraryAsideIfStale(dataDir, module)
		h.jobs.Enqueue(module)
	}
}

// requeueAfterBuild waits for module's running build to end (bounded), then moves the
// library aside if it is stale and enqueues its rebuild.
func (h serverHandlers) requeueAfterBuild(module string) {
	poll := h.coatingsSetup.requeuePoll
	if poll <= 0 {
		poll = 2 * time.Second
	}
	deadline := time.Now().Add(6 * time.Hour)
	for h.jobs.Snapshot(module).State == meshjobs.StateBuilding {
		if time.Now().After(deadline) {
			slog.Warn("coatings setup: library build still running, rebuild not queued", "library", module)
			return
		}
		time.Sleep(poll)
	}
	moveCoatingLibraryAsideIfStale(h.root.Dir(), module)
	h.jobs.Enqueue(module)
	slog.Info("coatings setup: library rebuild queued after its running build", "library", module)
}
