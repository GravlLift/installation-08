package main

// serve_jobs.go — the mesh build runner's wiring for `serve`: which output each job writes,
// whether it is on disk, and the build each job runs (map meshes, per-match variant layers,
// the weapon library, the first-person library), all through one queue.

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/firstperson"
	"github.com/llampwall/infinite-theater-3d/internal/meshbuild"
	"github.com/llampwall/infinite-theater-3d/internal/meshjobs"
	"github.com/llampwall/infinite-theater-3d/internal/store"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// jobModuleReady is the runner's own readiness check: it reports whether a module's output
// is on disk (a map's mesh file, or a library's index, or a match's variant layer). The
// startup step and the runner use it, so a build whose output is already on disk is never
// queued by either.
func jobModuleReady(root *store.Root, module string) bool {
	if id, ok := variantJobID(module); ok {
		_, err := os.Stat(variantPath(root, id, "variant.glb"))
		return err == nil
	}
	switch module {
	case meshjobs.JobWeapons:
		_, err := os.Stat(filepath.Join(root.Dir(), "weapons", "index.json"))
		return err == nil
	case meshjobs.JobFirstPerson:
		_, err := os.Stat(filepath.Join(root.Dir(), "first-person", "index.json"))
		return err == nil
	case meshjobs.JobWeaponIcons:
		return weaponicons.SetReady(root.Dir())
	}
	p, err := root.MeshPath(module)
	if err != nil {
		return false
	}
	_, err = os.Stat(p)
	return err == nil
}

// meshJobsFor wires the mesh build runner to the store: the ready callback reports whether a
// module's output is on disk (a map's mesh file, or the weapon library's index), the
// destination maps a module to its output file, and the builder runs the real map build for a
// map module and the real weapon-library build for the weapons job. The weapons job shares the
// runner's queue with the map builds, so it never runs beside one.
func meshJobsFor(root *store.Root, gameRoot string, weaponKeys weapons.Catalog) (*meshjobs.Runner, error) {
	ready := func(module string) bool { return jobModuleReady(root, module) }
	dest := func(module string) string {
		if id, ok := variantJobID(module); ok {
			return variantPath(root, id, "variant.glb")
		}
		switch module {
		case meshjobs.JobWeapons:
			return filepath.Join(root.Dir(), "weapons")
		case meshjobs.JobFirstPerson:
			return filepath.Join(root.Dir(), "first-person")
		case meshjobs.JobWeaponIcons:
			return weaponicons.OutDir(root.Dir())
		}
		p, err := root.MeshPath(module)
		if err != nil {
			return module + ".glb"
		}
		return p
	}
	build := func(ctx context.Context, module, game, out string) (meshjobs.BuildResult, error) {
		if id, ok := variantJobID(module); ok {
			result, err := buildMatchVariant(ctx, root, id, game, out)
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
		case meshjobs.JobWeaponIcons:
			return buildWeaponIcons(ctx, root, game)
		}
		summary, err := meshbuild.BuildMap(ctx, module, game, out, nil)
		if err != nil {
			return meshjobs.BuildResult{}, err
		}
		return meshjobs.BuildResult{Bytes: summary.Bytes, Triangles: summary.Triangles}, nil
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
	result, err := weapons.Build(ctx, weapons.Options{Catalog: keys, GameRoot: gameRoot, DataDir: root.Dir()}, nil)
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	return meshjobs.BuildResult{Bytes: result.Bytes, Triangles: 0}, nil
}

// buildFirstPersonLibrary runs the first-person library build into the store's first-person
// folder, opening the module index of the first map in the store (any installed map's index
// covers the game's weapons and globals). It is the first-person job's body in the mesh
// build runner.
func buildFirstPersonLibrary(ctx context.Context, root *store.Root, gameRoot string) (meshjobs.BuildResult, error) {
	result, err := firstperson.Build(ctx, firstperson.Options{Map: firstMapModule(root), GameRoot: gameRoot, DataDir: root.Dir()}, nil)
	if err != nil {
		return meshjobs.BuildResult{}, err
	}
	return meshjobs.BuildResult{Bytes: result.Bytes, Triangles: 0}, nil
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

// firstMapModule is the first map module key in the store, or "" when the store holds no
// match: the module index any installed map opens covers the game's weapons and globals.
func firstMapModule(root *store.Root) string {
	ms, err := root.ListMatches()
	if err != nil || len(ms) == 0 {
		return ""
	}
	return ms[0].MapModule
}
