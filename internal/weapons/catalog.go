// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package weapons builds and lays out the standalone's weapon model library: one GLB per
// weapon the 3D view can ask for, in the data directory, under the same keys and file names
// the view already addresses them by.
//
// The set is the game's own roster, the `weap` tags of the installed modules (one per weapon,
// in the `globals`/`common` modules any installed map's index covers), so the library covers
// every weapon a match can name without a replay-specific selection. A weapon whose model
// cannot be read is marked, not an error (the view falls back to a placeholder for it).
package weapons

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// Catalog is the set of model keys the library holds: every weapon the installed game names,
// by its model key (the weapon's `weap` tag family, 8 lowercase hex digits), in key order.
type Catalog struct {
	// Keys are the model keys, sorted.
	Keys []string
	// Map is the installed map whose module index the build opens (its search path covers the
	// game's `globals`/`common` modules, where the weapons live).
	Map string
}

// Discover reads the installed modules' `weap` tags and returns the roster's model keys.
// mapKey names the installed map to open the index from (its search path covers the
// `globals`/`common` modules where the weapons live); gameRoot is the deploy root (empty
// auto-detects it the way the build chain always does).
func Discover(ctx context.Context, mapKey, gameRoot string) (Catalog, error) {
	if gameRoot == "" {
		root, err := himap.DeployRoot()
		if err != nil {
			return Catalog{}, fmt.Errorf("game install: %w", err)
		}
		gameRoot = root
	}
	if mapKey == "" {
		// A fresh install has no stored match to name a map: any installed map's index covers
		// the `globals`/`common` modules, as the first-person and armor libraries already do.
		key, ok := firstInstalledMap(gameRoot)
		if !ok {
			return Catalog{}, fmt.Errorf("no installed map found under %s", gameRoot)
		}
		slog.InfoContext(ctx, "no map given; using the first installed map", "map", key)
		mapKey = key
	}
	module, ok := installedModule(gameRoot, mapKey)
	if !ok {
		return Catalog{}, fmt.Errorf("map %q is not installed", mapKey)
	}
	a, err := himap.OuvreArsenal(gameRoot, module)
	if err != nil {
		return Catalog{}, err
	}
	defer func() {
		if err := a.Close(); err != nil {
			slog.WarnContext(ctx, "closing arsenal", "err", err)
		}
	}()
	ids, err := a.RosterArmes(ctx)
	if err != nil {
		return Catalog{}, err
	}
	keys := make([]string, 0, len(ids))
	for _, id := range ids {
		keys = append(keys, fmt.Sprintf("%08x", id))
	}
	sort.Strings(keys)
	return Catalog{Keys: keys, Map: mapKey}, nil
}

// firstInstalledMap is the first map folder (directory order) whose module is installed.
func firstInstalledMap(gameRoot string) (string, bool) {
	entries, err := os.ReadDir(filepath.Join(gameRoot, "pc", "levels", "multi"))
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if _, ok := installedModule(gameRoot, e.Name()); ok {
			return e.Name(), true
		}
	}
	return "", false
}

// installedModule says whether the installed map `key`'s `.module` is present, and returns its
// path (the same layout build-weapon resolves through).
func installedModule(gameRoot, key string) (string, bool) {
	module := filepath.Join(gameRoot, "pc", "levels", "multi", key, key+"-rtx-new.module")
	if _, err := os.Stat(module); err != nil {
		return "", false
	}
	return module, true
}

// FirstInstalledModule returns the .module of the first installed map, in directory order
// under pc/levels/multi. The Spartan body and its animation graphs live in `pc/globals`,
// which every installed map's module covers, so any one of them suffices to read them.
func FirstInstalledModule(gameRoot string) (string, bool) {
	multi := filepath.Join(gameRoot, "pc", "levels", "multi")
	entries, err := os.ReadDir(multi)
	if err != nil {
		return "", false
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if m, ok := installedModule(gameRoot, e.Name()); ok {
			return m, true
		}
	}
	return "", false
}
