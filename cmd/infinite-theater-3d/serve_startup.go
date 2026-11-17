package main

// serve_startup.go — the serve startup step: when a game install is found, every one-time
// build the viewer needs is enqueued in the mesh jobs runner right away, in a fixed order.
//
// A one-time build is built once, in the background, when `serve` starts, and kept in the
// data folder: the weapon icon set, the weapon model library, the first-person library,
// the announcer sounds, and, for every match in the store, that match's map mesh and variant layer (each distinct
// map module once). The readiness of a build is the runner's own ready callback, so a build
// whose output is already on disk is never queued. The step never blocks startup: it only
// appends to the runner's queue and logs one line saying what it queued. When no install
// can be found it logs once and queues nothing.
//
// A match fetched while the server runs is enqueued where the server learns about it: the
// remote fetch route (`runRemoteFetch`), right after the fetch saves it. A match added by
// the CLI `import` or `fetch` while the server is not running has no queue to join; the
// next `serve` startup picks it up. The web request routes (mesh build, variant build,
// weapons build, first-person build) stay as they were: they report state and remain a
// harmless enqueue when something is missing.

import (
	"fmt"
	"log/slog"
	"os"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// startupMatch is the listing projection enqueueStartupBuilds needs from a store match:
// the id (the variant job's key) and the key of its world mesh (meshKeyOf, the mesh job's key).
type startupMatch struct {
	MatchID string
	MeshKey string
}

// hasMatchMvar says whether the match's map variant file is in the store (the variant
// build's input).
func hasMatchMvar(root *store.Root, id string) bool {
	_, err := os.Stat(variantPath(root, id, "map.mvar"))
	return err == nil
}

// enqueueStartupBuilds enqueues every one-time build that is not ready yet, in this order:
// the weapon icon set, the HUD icon set, the rank badge set, the home backdrop, the announcer
// sounds, the weapon library, the first-person library, the Spartan piece library, then, for every
// match in the store,
// that match's map mesh and variant layer (each
// distinct map module once, in the store's listing order). ready is the runner's own
// readiness check, so an output that is already on disk is skipped; variantExists says
// which matches have a stored map variant to build. outdated (nil: none) is the runner's own
// outdated check: a High-quality map or variant file that is on disk in an older build format is
// queued too (its update, in place for a format-2 file, takes seconds), but a High file that is
// absent is never built here (High is built only when the user picks it). Without it a High file
// stayed outdated until opened, and the viewer met it there. skipCoatingLibs leaves the three
// coating libraries unqueued: the coatings setup being run this startup queues them (with
// coatings) in its own completion step. It enqueues through jobs (its own Enqueue, so a
// recording wrapper is used transparently), never blocks, and logs one line naming what it
// queued (or "nothing"). A nil jobs or ready is a no-op.
func enqueueStartupBuilds(jobs interface {
	Enqueue(string) meshjobs.Snapshot
}, ready, outdated func(string) bool, matches []startupMatch, variantExists func(id string) bool, skipCoatingLibs bool) {
	if jobs == nil || ready == nil {
		return
	}
	queued := 0
	enqueue := func(module string) {
		jobs.Enqueue(module)
		queued++
	}
	if !ready(meshjobs.JobWeaponIcons) {
		enqueue(meshjobs.JobWeaponIcons)
	}
	if !ready(meshjobs.JobHudIcons) {
		enqueue(meshjobs.JobHudIcons)
	}
	if !ready(meshjobs.JobRanks) {
		enqueue(meshjobs.JobRanks)
	}
	if !ready(meshjobs.JobBackdrop) {
		enqueue(meshjobs.JobBackdrop)
	}
	if !ready(meshjobs.JobAnnouncer) {
		enqueue(meshjobs.JobAnnouncer)
	}
	// The three coating libraries read the Ekur export. When the coatings setup is being
	// run this startup, its own completion step queues them (with coatings), so the
	// startup leaves them out here.
	if !skipCoatingLibs {
		for _, module := range coatingLibraryModules {
			if !ready(module) {
				enqueue(module)
			}
		}
	}
	seen := map[string]bool{}
	// once enqueues a key the first time it is seen: Standard when not ready, High only when its
	// file is there but outdated.
	once := func(key string) {
		if seen[key] {
			return
		}
		seen[key] = true
		if !ready(key) {
			enqueue(key)
		}
		high := meshjobs.JobKey(key, meshjobs.QualityHigh)
		if outdated != nil && outdated(high) {
			enqueue(high)
		}
	}
	for _, m := range matches {
		if m.MeshKey != "" {
			once(m.MeshKey)
		}
		// The variant layer is per match: two matches on one map each get theirs.
		if variantExists != nil && variantExists(m.MatchID) {
			once(variantPrefix + m.MatchID)
		}
	}
	if queued > 0 {
		slog.Info("serve startup: enqueued one-time builds", "queued", queued)
	} else {
		slog.Info("serve startup: all one-time builds ready or absent, nothing queued")
	}
}

// runServeStartup is the serve startup step: it finds the game install once, and when it
// is found it enqueues every one-time build that is not ready yet, through the runner's
// own ready callback. It never blocks (the builds run in the runner's queue) and with no
// install found it logs once and queues nothing. It returns nothing; the caller keeps
// going to the listen.
func runServeStartup(jobs interface {
	Enqueue(string) meshjobs.Snapshot
}, ready, outdated func(string) bool, root *store.Root, gameRoot string, startCoatingsSetup func()) {
	if jobs == nil || ready == nil {
		return
	}
	if !weaponicons.GameRootFound(gameRoot) {
		slog.Warn("game install not found, one-time builds not started", "game", gameRoot, "env", himap.DeployRootEnv)
		// The console is the one place a double-click user reads: say it plainly, with the way out.
		fmt.Fprintf(os.Stderr, "\nHalo Infinite was not found on this PC, so maps, weapons and coatings cannot be built.\n"+
			"Searched: every Steam library, and <drive>:\\XboxGames\\Halo Infinite\\Content\\deploy on each drive.\n"+
			"If the game is installed elsewhere, close this window and start the app from a command prompt with\n"+
			"  infinite-theater-3d.exe serve --open --game \"<the game's deploy folder>\"\n"+
			"or set %s to that folder.\n\n", himap.DeployRootEnv)
		return
	}
	// Start the coatings setup when the override is unset and the app's own export is not
	// a valid one: the setup's own completion step queues the three coating libraries (with
	// coatings), so the startup leaves them out of the one-time builds. The override always
	// wins (never run the setup); a missing install (above) leaves today's behavior in place.
	skipCoatingLibs := false
	if startCoatingsSetup != nil {
		_, override := spartanpieces.EkurCandidate(root.Dir())
		if !override && !spartanpieces.EkurValid(spartanpieces.DataEkurDir(root.Dir())) {
			slog.Info("serve startup: no valid Ekur export, starting the coatings setup (it queues the coating libraries)")
			startCoatingsSetup()
			skipCoatingLibs = true
		}
	}
	renameStaleCoatingLibraries(root.Dir())
	ms, err := root.ListMatches()
	if err != nil {
		slog.Warn("list matches for startup builds", "err", err)
		return
	}
	matches := make([]startupMatch, 0, len(ms))
	for _, m := range ms {
		matches = append(matches, startupMatch{MatchID: m.MatchID, MeshKey: meshKeyOf(m)})
	}
	enqueueStartupBuilds(jobs, ready, outdated, matches, func(id string) bool {
		return hasMatchMvar(root, id)
	}, skipCoatingLibs)
}

// renameStaleCoatingLibraries moves each stale coating library aside (one log line each,
// naming the library and the stamps that differ) before the one-time builds are enqueued,
// so the normal build job rebuilds each one before the routes serve it. Never a downgrade:
// with no valid export, existing libraries are left in place.
func renameStaleCoatingLibraries(dataDir string) {
	for _, module := range coatingLibraryModules {
		moveCoatingLibraryAsideIfStale(dataDir, module)
	}
}

// coatingLibraryModules are the three libraries that read the Ekur export, in the order the
// startup enqueues them.
var coatingLibraryModules = []string{meshjobs.JobWeapons, meshjobs.JobFirstPerson, meshjobs.JobSpartanPieces}

// moveCoatingLibraryAsideIfStale moves one coating library aside when its recorded stamp
// differs from the current export's (one log line naming both stamps). Never a downgrade:
// with no valid export, the library is left in place.
func moveCoatingLibraryAsideIfStale(dataDir, module string) {
	cur, ok := currentEkurStamp(dataDir)
	if !ok || cur == "" {
		return
	}
	stamp, ok := recordedEkurStamp(dataDir, module)
	if !ok || stamp == cur {
		return
	}
	slog.Info("coating library stale", "library", module, "old_stamp", stamp, "new_stamp", cur)
	moveStaleCoatingLibrary(dataDir, module)
}

// enqueueMatchBuilds enqueues one match's map mesh and, when its map variant file is
// present, its variant layer. It is the place a match added while the server runs (the
// remote fetch route) is added to the build queue; the runner's Enqueue re-derives
// readiness, so an output already on disk is never queued and a module already queued is
// joined, not duplicated.
func (h serverHandlers) enqueueMatchBuilds(id string) {
	if h.jobs == nil {
		return
	}
	meta, err := h.root.MatchMeta(id)
	if err != nil {
		return
	}
	if key := meshKeyOf(meta); key != "" {
		h.jobs.Enqueue(key)
	}
	if hasMatchMvar(h.root, id) {
		h.jobs.Enqueue(variantPrefix + id)
	}
}
