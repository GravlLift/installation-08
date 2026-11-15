package main

// serve_jobs.go — the mesh build runner's wiring for `serve`: which output each job writes,
// whether it is on disk, and the build each job runs (map meshes, per-match variant layers,
// the weapon library, the first-person library), all through one queue.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sync"

	"github.com/llampwall/infinite-theater-3d/internal/backdrop"
	"github.com/llampwall/infinite-theater-3d/internal/firstperson"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/rankicons"
	"github.com/llampwall/infinite-theater-3d/internal/safefs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// jobModuleReady is the runner's own readiness check: it reports whether a module's output
// is on disk (a map's mesh file, or a library's index, or a match's variant layer). The
// startup step and the runner use it, so a build whose output is already on disk is never
// queued by either.
func jobModuleReady(root *store.Root, module string) bool {
	module, quality := meshjobs.SplitQuality(module)
	if id, ok := variantJobID(module); ok {
		_, err := os.Stat(variantPath(root, id, variantGLBName(quality)))
		return err == nil
	}
	switch module {
	case meshjobs.JobWeapons, meshjobs.JobFirstPerson, meshjobs.JobSpartanPieces:
		return coatingLibraryReady(root.Dir(), module)
	case meshjobs.JobWeaponIcons:
		return weaponicons.SetReady(root.Dir())
	case meshjobs.JobHudIcons:
		return weaponicons.HudSetReady(root.Dir())
	case meshjobs.JobRanks:
		return rankicons.SetReady(root.Dir())
	case meshjobs.JobBackdrop:
		return backdrop.SetReady(root.Dir())
	case meshjobs.JobAnnouncer:
		return announcerReady(root.Dir())
	}
	p, err := root.MeshPath(module, quality)
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

// staleSuffix marks a library folder the startup moved aside because its index no longer
// matches the Ekur export: the normal build job rebuilds the library over the folder name,
// and the old folder is removed once the new build succeeds. The suffix is never a valid
// library file name, so a stray marker left behind is inert (never served, never re-queued).
const staleSuffix = ".stale"

// coatingLibraryReady is the readiness of the three coating libraries (weapons,
// first-person, spartan-pieces): the index is present and its recorded Ekur stamp matches
// the current export (or the current export is absent, which never downgrades a library).
// A library without a recorded stamp (built before stamps existed) is ready only when no
// export is available: an export that appears later rebuilds it. An index missing a field the
// view reads (libraryIndexCurrent) is never ready.
func coatingLibraryReady(dataDir, module string) bool {
	stamp, ok := recordedEkurStamp(dataDir, module)
	if !ok || !libraryIndexCurrent(dataDir, module) {
		return false
	}
	cur, ok := currentEkurStamp(dataDir)
	if !ok {
		return false
	}
	if cur == "" {
		return true
	}
	return stamp == cur
}

// ekurStampCache holds the current export's stamp per data directory, computed once per
// process: readiness runs on every build-state poll (under the runner's lock), and reading a
// full export's tens of thousands of names each time would stall it. An export change takes
// effect at the next start, which is also when stale libraries are moved aside, or right
// away when the in-app coatings setup wrote it (forgetEkurStamps).
var ekurStampCache sync.Map // export folder ("" for none) -> ekurStampEntry

type ekurStampEntry struct {
	stamp string
	ok    bool
}

// forgetEkurStamps drops every cached export stamp: the coatings setup calls it once it has
// swapped a new export into <data>/ekur, so readiness sees the new stamp without a restart.
func forgetEkurStamps() {
	ekurStampCache.Range(func(k, _ any) bool {
		ekurStampCache.Delete(k)
		return true
	})
}

// currentEkurStamp is the stamp of the export EkurDir resolves for dataDir: "" with true
// when no valid export is set (never a downgrade), false when the export cannot be read.
func currentEkurStamp(dataDir string) (string, bool) {
	// Resolving the folder is cheap (five stats); listing it is what the cache saves.
	dir := spartanpieces.EkurDir(dataDir)
	if dir == "" {
		return "", true
	}
	if v, hit := ekurStampCache.Load(dir); hit {
		e := v.(ekurStampEntry)
		return e.stamp, e.ok
	}
	e := ekurStampEntry{ok: true}
	stamp, err := spartanpieces.EkurStamp(dir)
	if err != nil {
		slog.Warn("current ekur stamp could not be read", "err", err)
		e.ok = false
	}
	e.stamp = stamp
	ekurStampCache.Store(dir, e)
	return e.stamp, e.ok
}

// recordedEkurStamp reads the "ekur_stamp" field of a coating library's index.json; false
// when the index is absent or unreadable.
func recordedEkurStamp(dataDir, module string) (string, bool) {
	folder, ok := coatingLibraryFolder(module)
	if !ok {
		return "", false
	}
	raw, err := os.ReadFile(filepath.Join(dataDir, folder, "index.json"))
	if err != nil {
		return "", false
	}
	var idx struct {
		EkurStamp string `json:"ekur_stamp"`
	}
	if err := json.Unmarshal(raw, &idx); err != nil {
		return "", false
	}
	return idx.EkurStamp, true
}

// libraryIndexCurrent says whether a coating library's index carries every field the view reads
// from it: the weapon library's index must carry its red-reticle ranges with the per-level zoom
// magnifications, its team banners and its equipment families by the current rule
// (weapons.IndexCurrent), so a library built before them is
// stale and its rebuild, in place, adds them. The other libraries have no such field.
func libraryIndexCurrent(dataDir, module string) bool {
	if module != meshjobs.JobWeapons {
		return true
	}
	raw, err := os.ReadFile(filepath.Join(dataDir, "weapons", "index.json"))
	return err == nil && weapons.IndexCurrent(raw)
}

// coatingLibraryFolder is the data-directory folder of a coating library module key, and
// whether the key is one (map meshes, icons and variant layers are not).
func coatingLibraryFolder(module string) (string, bool) {
	switch module {
	case meshjobs.JobWeapons:
		return "weapons", true
	case meshjobs.JobFirstPerson:
		return "first-person", true
	case meshjobs.JobSpartanPieces:
		return "spartan-pieces", true
	}
	return "", false
}

// meshJobsFor wires the mesh build runner to the store: the ready callback reports whether a
// module's output is on disk (a map's mesh file, or the weapon library's index), the
// destination maps a module to its output file, and the builder runs the real map build for a
// map module and the real weapon-library build for the weapons job. The weapons job shares the
// runner's queue with the map builds, so it never runs beside one.
func meshJobsFor(root *store.Root, gameRoot string, weaponKeys weapons.Catalog) (*meshjobs.Runner, error) {
	ready := func(module string) bool { return jobModuleReady(root, module) }
	dest := func(module string) string {
		module, quality := meshjobs.SplitQuality(module)
		if id, ok := variantJobID(module); ok {
			return variantPath(root, id, variantGLBName(quality))
		}
		switch module {
		case meshjobs.JobWeapons:
			return filepath.Join(root.Dir(), "weapons")
		case meshjobs.JobFirstPerson:
			return filepath.Join(root.Dir(), "first-person")
		case meshjobs.JobSpartanPieces:
			return filepath.Join(root.Dir(), "spartan-pieces")
		case meshjobs.JobWeaponIcons:
			return weaponicons.OutDir(root.Dir())
		case meshjobs.JobHudIcons:
			return weaponicons.HudOutDir(root.Dir())
		case meshjobs.JobRanks:
			return rankicons.OutDir(root.Dir())
		case meshjobs.JobBackdrop:
			return backdrop.OutDir(root.Dir())
		case meshjobs.JobAnnouncer:
			return soundsDir(root.Dir())
		}
		p, err := root.MeshPath(module, quality)
		if err != nil {
			return module + ".glb"
		}
		return p
	}
	build := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		module, quality := meshjobs.SplitQuality(module)
		if id, ok := variantJobID(module); ok {
			result, err := buildMatchVariant(ctx, root, id, game, out, quality)
			if err != nil {
				slog.Warn("variant build failed", "id", id, "err", err)
			}
			return result, err
		}
		switch module {
		case meshjobs.JobWeapons:
			return buildWeaponLibrary(ctx, root, game, weaponKeys)
		case meshjobs.JobFirstPerson:
			return buildFirstPersonLibrary(ctx, root, game)
		case meshjobs.JobSpartanPieces:
			return buildSpartanPieceLibrary(ctx, root, game)
		case meshjobs.JobWeaponIcons:
			return buildWeaponIcons(ctx, root, game)
		case meshjobs.JobHudIcons:
			return buildHudIcons(ctx, root, game)
		case meshjobs.JobRanks:
			return buildRanks(ctx, root, game)
		case meshjobs.JobBackdrop:
			return buildBackdrop(ctx, root, game)
		case meshjobs.JobAnnouncer:
			return buildAnnouncer(ctx, root, game)
		}
		return buildMapMesh(ctx, root, module, game, out, quality)
	}
	r, err := meshjobs.New(build, gameRoot, ready)
	if err != nil {
		return nil, err
	}
	r.SetDest(dest)
	return r, nil
}

// buildWeaponLibrary runs the weapon library build into the store's weapons folder. It is the
// weapons job's body in the mesh build runner.
func buildWeaponLibrary(ctx context.Context, root *store.Root, gameRoot string, keys weapons.Catalog) (meshjobs.BuildResult, error) {
	// The startup catalog names only the map: discover the game's weapon roster from it, as
	// build-weapons does. Without this the build wrote only the extras (body, grenades).
	if len(keys.Keys) == 0 {
		cat, err := weapons.Discover(ctx, keys.Map, gameRoot)
		if err != nil {
			restoreStaleCoatingLibrary(root.Dir(), meshjobs.JobWeapons)
			return meshjobs.BuildResult{}, fmt.Errorf("weapon roster: %w", err)
		}
		keys = cat
	}
	result, err := weapons.Build(ctx, weapons.Options{Catalog: keys, GameRoot: gameRoot, DataDir: root.Dir()}, nil)
	if err == nil && result.Built == 0 {
		err = errors.New("weapon library build wrote no weapon model")
	}
	if err != nil {
		restoreStaleCoatingLibrary(root.Dir(), meshjobs.JobWeapons)
		return meshjobs.BuildResult{}, err
	}
	removeStaleCoatingLibrary(root.Dir(), meshjobs.JobWeapons)
	return meshjobs.BuildResult{Bytes: result.Bytes, Triangles: 0}, nil
}

// buildFirstPersonLibrary runs the first-person library build into the store's first-person
// folder, opening the module index of the first map in the store (any installed map's index
// covers the game's weapons and globals). It is the first-person job's body in the mesh
// build runner.
func buildFirstPersonLibrary(ctx context.Context, root *store.Root, gameRoot string) (meshjobs.BuildResult, error) {
	result, err := firstperson.Build(ctx, firstperson.Options{Map: firstMapModule(root), GameRoot: gameRoot, DataDir: root.Dir()}, nil)
	if err != nil {
		restoreStaleCoatingLibrary(root.Dir(), meshjobs.JobFirstPerson)
		return meshjobs.BuildResult{}, err
	}
	removeStaleCoatingLibrary(root.Dir(), meshjobs.JobFirstPerson)
	return meshjobs.BuildResult{Bytes: result.Bytes, Triangles: 0}, nil
}

// buildSpartanPieceLibrary runs the Spartan armor piece library build into the
// store's spartan-pieces folder, opening the module index of the first map in the
// store (any installed map's index covers the game's globals, where the Spartan
// lives). It is the spartan-pieces job's body in the mesh build runner.
func buildSpartanPieceLibrary(ctx context.Context, root *store.Root, gameRoot string) (meshjobs.BuildResult, error) {
	result, err := spartanpieces.Build(ctx, spartanpieces.Options{Map: firstMapModule(root), GameRoot: gameRoot, DataDir: root.Dir()}, nil)
	if err != nil {
		restoreStaleCoatingLibrary(root.Dir(), meshjobs.JobSpartanPieces)
		return meshjobs.BuildResult{}, err
	}
	removeStaleCoatingLibrary(root.Dir(), meshjobs.JobSpartanPieces)
	return meshjobs.BuildResult{Bytes: result.Bytes, Triangles: result.Triangles}, nil
}

// buildWeaponIcons runs the weapon-icon build into the store's data directory. It is the
// weapon-icons job's body in the mesh build runner.
func buildWeaponIcons(ctx context.Context, root *store.Root, gameRoot string) (meshjobs.BuildResult, error) {
	entries, n, err := weaponicons.Build(ctx, gameRoot, root.Dir())
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	slog.InfoContext(ctx, "weapon icons built", "entries", entries, "bytes", n)
	return meshjobs.BuildResult{Bytes: int64(n), Triangles: 0}, nil
}

// buildHudIcons runs the HUD equipment/grenade icon build into the store's data directory.
// It is the hud-icons job's body in the mesh build runner.
func buildHudIcons(ctx context.Context, root *store.Root, gameRoot string) (meshjobs.BuildResult, error) {
	files, named, n, err := weaponicons.BuildHud(ctx, gameRoot, root.Dir())
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	slog.InfoContext(ctx, "hud icons built", "files", files, "named", named, "bytes", n)
	return meshjobs.BuildResult{Bytes: int64(n), Triangles: 0}, nil
}

// buildRanks runs the rank badge build into the store's data directory. It is the
// ranks job's body in the mesh build runner.
func buildRanks(ctx context.Context, root *store.Root, gameRoot string) (meshjobs.BuildResult, error) {
	files, n, err := rankicons.Build(ctx, gameRoot, root.Dir())
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	slog.InfoContext(ctx, "rank badges built", "files", files, "bytes", n)
	return meshjobs.BuildResult{Bytes: int64(n), Triangles: 0}, nil
}

// buildBackdrop runs the home backdrop build into the store's data directory. It is the
// backdrop job's body in the mesh build runner.
func buildBackdrop(ctx context.Context, root *store.Root, gameRoot string) (meshjobs.BuildResult, error) {
	files, n, err := backdrop.Build(ctx, gameRoot, root.Dir())
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	slog.InfoContext(ctx, "ring backdrop built", "files", files, "bytes", n)
	return meshjobs.BuildResult{Bytes: int64(n), Triangles: 0}, nil
}

// moveStaleCoatingLibrary moves a stale coating library's folder aside (to <name>.stale,
// replacing any older one) so the normal build job rebuilds it before the routes serve it.
// A rename to a folder target that already exists fails on Windows, so the older .stale is
// removed first. A removal that hits a symlink or junction is refused: the log says so and
// the folder stays in place (a stray .stale is inert: never served, never re-queued, and it
// replaces the older one on the next stale startup). It logs one line per stale library.
func moveStaleCoatingLibrary(dataDir, module string) {
	folder, ok := coatingLibraryFolder(module)
	if !ok {
		return
	}
	dir := filepath.Join(dataDir, folder)
	stale := dir + staleSuffix
	// Removing the older .stale first (and on Windows, even when the rename would fail
	// over an existing target) is what makes the replacement happen.
	if err := removeTreeRefusingSymlinks(stale, "previous stale library"); err != nil {
		slog.Warn("stale library not replaced", "library", folder, "err", err)
	}
	if err := os.Rename(dir, stale); err != nil {
		slog.Warn("stale library not moved", "library", folder, "err", err)
		return
	}
	slog.Info("coating library stale: moved aside, rebuild queued", "library", folder)
}

// removeStaleCoatingLibrary removes a stale library folder after its rebuild succeeded. A
// refusal to follow a symlink or junction leaves it in place (it is inert, and the next
// stale startup replaces it), logged.
func removeStaleCoatingLibrary(dataDir, module string) {
	folder, ok := coatingLibraryFolder(module)
	if !ok {
		return
	}
	if err := removeTreeRefusingSymlinks(filepath.Join(dataDir, folder)+staleSuffix, "stale library"); err != nil {
		slog.Warn("stale library left in place", "library", folder, "err", err)
	} else {
		slog.Info("stale library removed after rebuild", "library", folder)
	}
}

// restoreStaleCoatingLibrary puts a stale library back when its rebuild failed: a stale
// library still renders (only some coatings are out of date), an absent one renders nothing.
// The failed build's partial folder is removed first (refusing symlinks and junctions); if
// that is refused, or no .stale folder exists, nothing is moved.
func restoreStaleCoatingLibrary(dataDir, module string) {
	folder, ok := coatingLibraryFolder(module)
	if !ok {
		return
	}
	dir := filepath.Join(dataDir, folder)
	stale := dir + staleSuffix
	if _, err := os.Lstat(stale); err != nil {
		return
	}
	if err := removeTreeRefusingSymlinks(dir, "failed library build"); err != nil {
		slog.Warn("stale library not restored", "library", folder, "err", err)
		return
	}
	if err := os.Rename(stale, dir); err != nil {
		slog.Warn("stale library not restored", "library", folder, "err", err)
		return
	}
	slog.Warn("library rebuild failed: previous library restored", "library", folder)
}

// removeTreeRefusingSymlinks removes path (a library folder set aside by the startup) and
// everything under it, refusing to follow a symlink or a directory junction: any reparse
// point found in the walk leaves the tree untouched and its own error says so. It is the
// only code that deletes a .stale folder, and it never deletes anything outside it. The
// removal itself is safefs.RemoveTree, shared with the coatings setup.
func removeTreeRefusingSymlinks(path, what string) error {
	return safefs.RemoveTree(path, what)
}

// firstMapModule is the first map module key in the store, or "" when the store holds no
// match: the module index any installed map opens covers the game's weapons and globals.
func firstMapModule(root *store.Root) string {
	ms, err := root.ListMatches()
	if err != nil || len(ms) == 0 {
		return ""
	}
	return ms[0].MapModule
}
