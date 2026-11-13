package main

// serve_startup.go — the serve startup step: when a game install is found, every one-time
// build the viewer needs is enqueued in the mesh jobs runner right away, in a fixed order.
//
// A one-time build is built once, in the background, when `serve` starts, and kept in the
// data folder: the weapon icon set, the weapon model library, the first-person library,
// and, for every match in the store, that match's map mesh and variant layer (each distinct
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
	"log/slog"
	"os"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// startupMatch is the listing projection enqueueStartupBuilds needs from a store match:
// the id (the variant job's key) and the map module (the mesh job's key).
type startupMatch struct {
	MatchID   string
	MapModule string
}

// hasMatchMvar says whether the match's map variant file is in the store (the variant
// build's input).
func hasMatchMvar(root *store.Root, id string) bool {
	_, err := os.Stat(variantPath(root, id, "map.mvar"))
	return err == nil
}

// enqueueStartupBuilds enqueues every one-time build that is not ready yet, in this order:
// the weapon icon set, the weapon library, the first-person library, then, for every match
// in the store, that match's map mesh and variant layer (each distinct map module once, in
// the store's listing order). ready is the runner's own readiness check, so an output that
// is already on disk is skipped; variantExists says which matches have a stored map variant
// to build. It enqueues through jobs (its own Enqueue, so a recording wrapper is used
// transparently), never blocks, and logs one line naming what it queued (or "nothing"). A
// nil jobs or ready is a no-op.
func enqueueStartupBuilds(jobs interface {
	Enqueue(string) meshjobs.Snapshot
}, ready func(string) bool, matches []startupMatch, variantExists func(id string) bool) {
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
	if !ready(meshjobs.JobWeapons) {
		enqueue(meshjobs.JobWeapons)
	}
	if !ready(meshjobs.JobFirstPerson) {
		enqueue(meshjobs.JobFirstPerson)
	}
	seen := map[string]bool{}
	for _, m := range matches {
		if m.MapModule != "" && !seen[m.MapModule] {
			seen[m.MapModule] = true
			if !ready(m.MapModule) {
				enqueue(m.MapModule)
			}
			if variantExists != nil && variantExists(m.MatchID) {
				key := variantPrefix + m.MatchID
				if !seen[key] {
					seen[key] = true
					if !ready(key) {
						enqueue(key)
					}
				}
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
}, ready func(string) bool, root *store.Root, gameRoot string) {
	if jobs == nil || ready == nil {
		return
	}
	if !weaponicons.GameRootFound(gameRoot) {
		if gameRoot != "" {
			slog.Warn("game install not found, one-time builds not started", "game", gameRoot, "env", himap.DeployRootEnv)
		}
		return
	}
	ms, err := root.ListMatches()
	if err != nil {
		slog.Warn("list matches for startup builds", "err", err)
		return
	}
	matches := make([]startupMatch, 0, len(ms))
	for _, m := range ms {
		matches = append(matches, startupMatch{MatchID: m.MatchID, MapModule: m.MapModule})
	}
	enqueueStartupBuilds(jobs, ready, matches, func(id string) bool {
		return hasMatchMvar(root, id)
	})
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
	if meta.MapModule != "" {
		h.jobs.Enqueue(meta.MapModule)
	}
	if hasMatchMvar(h.root, id) {
		h.jobs.Enqueue(variantPrefix + id)
	}
}
