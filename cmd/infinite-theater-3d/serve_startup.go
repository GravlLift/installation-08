// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

// serve_startup.go — the serve startup step: when a game install is found, every one-time
// library the viewer needs is enqueued in the mesh jobs runner right away, in a fixed order.
//
// A one-time build is built once, in the background, when `serve` starts, and kept in the
// data folder: the weapon icon set, the weapon model library, the first-person library,
// the announcer sounds. The readiness of a build is the runner's own ready callback, so a build
// whose output is already on disk is never queued. The step never blocks startup: it only
// appends to the runner's queue and logs one line saying what it queued. When no install
// can be found it logs once and queues nothing.
//
// Map meshes and variant layers are never built ahead: a match's map and layer are built when
// the match is opened (the pre-game's mesh build and the viewer's variant check). Building every
// stored or fetched match's map at startup cost a first start with 17 matches 37 minutes, about
// 5.5 GB of disk and an 8 GB peak (2026-11-18), for maps the user may never open.

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/texcompress"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// hasMatchMvar says whether the match's map variant file is in the store (the variant
// build's input).
func hasMatchMvar(root *store.Root, id string) bool {
	_, err := os.Stat(variantPath(root, id, "map.mvar"))
	return err == nil
}

// enqueueStartupBuilds enqueues every one-time library build that is not ready yet, in this
// order: the weapon icon set, the HUD icon set, the rank badge set, the home backdrop, the
// announcer sounds, the weapon library, the first-person library, the Spartan piece library. No
// map mesh or variant layer: those build when their match is opened. ready is the runner's own
// readiness check, so an output that is already on disk is skipped. skipCoatingLibs leaves the
// three coating libraries unqueued: the coatings setup being run this startup queues them (with
// coatings) in its own completion step. It enqueues through jobs (its own Enqueue, so a
// recording wrapper is used transparently), never blocks, and logs one line naming what it
// queued (or "nothing"). A nil jobs or ready is a no-op.
func enqueueStartupBuilds(jobs interface {
	Enqueue(string) meshjobs.Snapshot
}, ready func(string) bool, skipCoatingLibs bool) {
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
}, ready func(string) bool, root *store.Root, gameRoot string, startCoatingsSetup func()) {
	if jobs == nil || ready == nil {
		return
	}
	dataDir := root.Dir()
	inBackground(func() { removeStaleBuildTemps(dataDir, time.Now()) })
	if !weaponicons.GameRootFound(gameRoot) {
		slog.Warn("game install not found, one-time builds not started", "game", gameRoot, "env", himap.DeployRootEnv)
		// The console is the one place a double-click user reads: say it plainly, with the way out.
		fmt.Fprintf(os.Stderr, "\nHalo Infinite was not found on this PC, so maps, weapons and coatings cannot be built.\n"+
			"Searched: every Steam library, and <drive>:\\XboxGames\\Halo Infinite\\Content\\deploy on each drive.\n"+
			"If the game is installed elsewhere, close this window and start the app from a command prompt with\n"+
			"  installation-08.exe serve --open --game \"<the game's deploy folder>\"\n"+
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
	if !skipCoatingLibs {
		realignLibraries(root.Dir(), ready)
	}
	enqueueStartupBuilds(jobs, ready, skipCoatingLibs)
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

// coatingLibraryDirs are the data folders of the three coating libraries.
var coatingLibraryDirs = map[string]string{
	meshjobs.JobWeapons:       "weapons",
	meshjobs.JobFirstPerson:   "first-person",
	meshjobs.JobSpartanPieces: "spartan-pieces",
}

// realignLibraries upgrades, in the background, each coating library that is ready (built,
// not stale, so no build of it is queued to race the walk) and was written before the encoder
// block-aligned its KTX2 images: texcompress.RealignDir rewrites only the misaligned files (the
// first-person library built on 2026-11-17 held a 256x126 map and 1x1 placeholders, which
// Direct3D 11 refuses to upload) and leaves a marker so later startups skip the folder. A stale
// library is moved aside and rebuilt by today's encoder, aligned already.
func realignLibraries(dataDir string, ready func(string) bool) {
	var dirs []string
	for _, module := range coatingLibraryModules {
		if ready(module) {
			dirs = append(dirs, filepath.Join(dataDir, coatingLibraryDirs[module]))
		}
	}
	if len(dirs) == 0 {
		return
	}
	inBackground(func() {
		for _, dir := range dirs {
			t0 := time.Now()
			n, err := texcompress.RealignDir(context.Background(), dir, texcompress.Options{Workers: 1})
			if err != nil {
				slog.Warn("library textures realign", "dir", dir, "rewritten", n, "err", err)
			} else if n > 0 {
				slog.Info("library textures realigned", "dir", dir, "rewritten", n, "took", time.Since(t0).Round(time.Millisecond).String())
			}
		}
	})
}

// inBackground runs f on its own goroutine (the package's tests run it in the caller).
var inBackground = func(f func()) { go f() }

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
