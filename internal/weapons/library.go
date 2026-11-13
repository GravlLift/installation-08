package weapons

// library.go builds the weapon model library on demand: one GLB per model key (every weapon in
// the catalog, the game's grenade projectiles, and the Spartan body), into the weapons folder of
// the data directory, then writes index.json. It reuses the same per-model builders the
// build-weapon and build-spartan commands use (mapmesh), so the GLBs are byte-compatible with
// what a single-weapon build produces.

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// Options names a library build's inputs.
type Options struct {
	// Catalog is the set of model keys to build (from Discover).
	Catalog Catalog
	// GameRoot is the deploy root; empty auto-detects it.
	GameRoot string
	// DataDir is the data directory; the library lands in <DataDir>/weapons.
	DataDir string
}

// Result summarizes a library build.
type Result struct {
	Built    int
	Skipped  int
	Coatings int
	Bytes    int64
	Seconds  float64
}

// Build builds the whole library described by opts.Catalog into <DataDir>/weapons and writes
// index.json. A weapon whose model cannot be read is marked with an empty <key>.none file (the
// view falls back to a placeholder) and the build continues. The grenade projectiles and the
// Spartan are always attempted. announce (nil accepted) receives a one-line log at each step.
func Build(ctx context.Context, opts Options, announce func(string)) (Result, error) {
	if announce == nil {
		announce = func(string) {}
	}
	start := time.Now()
	if opts.Catalog.Map == "" {
		return Result{}, errors.New("weapons: catalog has no map key")
	}
	gameRoot, err := resolveGameRoot(opts.GameRoot)
	if err != nil {
		return Result{}, err
	}
	module, ok := installedModule(gameRoot, opts.Catalog.Map)
	if !ok {
		return Result{}, fmt.Errorf("map %q is not installed", opts.Catalog.Map)
	}
	dir := filepath.Join(opts.DataDir, "weapons")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return Result{}, fmt.Errorf("weapons directory: %w", err)
	}

	coats, err := spartanpieces.OpenCoatingWork(spartanpieces.EkurDir(opts.DataDir))
	if err != nil {
		return Result{}, err
	}
	if coats == nil {
		slog.WarnContext(ctx, "weapon library without coatings: no ekur reference")
	}
	a, err := himap.OuvreArsenal(gameRoot, module)
	if err != nil {
		return Result{}, err
	}
	defer func() {
		if err := a.Close(); err != nil {
			slog.WarnContext(ctx, "closing arsenal", "err", err)
		}
	}()

	var res Result
	for _, key := range opts.Catalog.Keys {
		announce("building weapon " + key)
		n, err := buildWeaponModel(ctx, a, key, dir, coats)
		if err != nil {
			if errors.Is(err, himap.ErrSansModele) {
				if merr := writeMarker(dir, key); merr != nil {
					return res, fmt.Errorf("marker for %s: %w", key, merr)
				}
				res.Skipped++
				continue
			}
			return res, fmt.Errorf("weapon %s: %w", key, err)
		}
		res.Built++
		res.Bytes += n
	}
	announce("building grenade projectiles")
	for _, rank := range grenadeRanks(ctx, a) {
		n, err := buildGrenadeModel(ctx, a, rank, dir)
		if err != nil {
			if errors.Is(err, himap.ErrSansModele) {
				res.Skipped++
				continue
			}
			return res, fmt.Errorf("grenade %d: %w", rank, err)
		}
		res.Built++
		res.Bytes += n
	}
	announce("building spartan body")
	if n, err := buildSpartanModel(ctx, gameRoot, module, dir); err != nil {
		return res, fmt.Errorf("spartan: %w", err)
	} else {
		res.Built++
		res.Bytes += n
	}

	idx := NewIndex(opts.Catalog.Keys, generatorLibrary)
	if coats != nil {
		idx.Coatings, err = coats.Finish(ctx, a, dir)
		if err != nil {
			return res, err
		}
		res.Coatings = idx.Coatings.Coatings
		res.Bytes += idx.Coatings.Bytes
	}
	if err := writeIndex(dir, idx); err != nil {
		return res, err
	}
	res.Seconds = time.Since(start).Seconds()
	return res, nil
}

// buildWeaponModel writes one weapon's painted GLB (its hard surfaces as raw
// images, extras.surfaceBrute) and returns its byte size.
func buildWeaponModel(ctx context.Context, a *himap.Arsenal, key, dir string, coats *spartanpieces.CoatingWork) (int64, error) {
	id, err := parseKey(key)
	if err != nil {
		return 0, err
	}
	m, err := a.Arme(ctx, id)
	if err != nil {
		return 0, err
	}
	m.SurfacesBrutes = true
	return writeModelGLB(ctx, dir, key, m, coats, generatorWeapon, map[string]any{"weap": key})
}

// buildGrenadeModel writes one grenade projectile's GLB and returns its byte size.
func buildGrenadeModel(ctx context.Context, a *himap.Arsenal, rank int, dir string) (int64, error) {
	m, err := a.Grenade(ctx, rank)
	if err != nil {
		return 0, err
	}
	return writeModelGLB(ctx, dir, GrenadeKey(rank), m, nil, generatorGrenade, map[string]any{"grenade": rank})
}

// buildSpartanModel writes the Spartan body's animated GLB and returns its byte size, through
// the shared mapmesh builder (which re-opens the arsenal for the skin), so the model is
// identical to build-spartan's output.
func buildSpartanModel(ctx context.Context, gameRoot, module, dir string) (int64, error) {
	target := mapmesh.SpartanTarget{Module: module}
	summary, err := mapmesh.BuildSpartan(ctx, gameRoot, target, filepath.Join(dir, FileOf(KeySpartan)), generatorSpartan, nil)
	if err != nil {
		return 0, err
	}
	return summary.Bytes, nil
}

// grenadeRanks returns the ranks of the installed game's grenade projectiles (0..n-1).
func grenadeRanks(ctx context.Context, a *himap.Arsenal) []int {
	var ranks []int
	for r := 0; ; r++ {
		if _, err := a.Grenade(ctx, r); err != nil {
			break
		}
		ranks = append(ranks, r)
	}
	return ranks
}

// parseKey parses a weapon model key into its `weap` tag GlobalID.
func parseKey(key string) (uint32, error) {
	id, err := strconv.ParseUint(key, 16, 32)
	if err != nil {
		return 0, fmt.Errorf("weapon key %q: not 8 hex digits", key)
	}
	return uint32(id), nil
}

// writeModelGLB writes the model's GLB to dir/FileOf(key) atomically and returns its byte
// size. coats (nil accepted) puts the coating style on the painted materials before the write.
func writeModelGLB(ctx context.Context, dir, key string, m *himap.MaillageMonde, coats *spartanpieces.CoatingWork,
	generator string, extras map[string]any) (int64, error) {
	var buf bytes.Buffer
	if err := himap.EcritGLB(&buf, m, generator, withAxes(extras)); err != nil {
		return 0, err
	}
	glb := buf.Bytes()
	if coats != nil {
		var err error
		if glb, err = himap.AnnoteMateriauxGLB(glb, coats.Annotate(ctx)); err != nil {
			return 0, err
		}
	}
	return writeFile(filepath.Join(dir, FileOf(key)), func(w ioWriter) error {
		_, err := w.Write(glb)
		return err
	})
}

// writeIndex writes the library index.json atomically.
func writeIndex(dir string, idx Index) error {
	raw, err := json.MarshalIndent(idx, "", "  ")
	if err != nil {
		return err
	}
	_, err = writeFile(filepath.Join(dir, "index.json"), func(w ioWriter) error {
		_, werr := w.Write(raw)
		return werr
	})
	return err
}

// writeMarker writes the empty <key>.none file for a weapon with no readable model.
func writeMarker(dir, key string) error {
	return os.WriteFile(filepath.Join(dir, key+".none"), nil, 0o644) //nolint:gosec // cache marker, set by the caller
}

// resolveGameRoot returns the deploy root, auto-detecting it when gameRoot is empty.
func resolveGameRoot(gameRoot string) (string, error) {
	if gameRoot != "" {
		return gameRoot, nil
	}
	return himap.DeployRoot()
}

// generator tags name the chain that produced each GLB, in its extras.
const (
	generatorLibrary = "cmd/infinite-theater-3d build-weapons (halo-infinite-map-images, weapon library)"
	generatorWeapon  = "cmd/infinite-theater-3d build-weapons (halo-infinite-map-images, weapon model)"
	generatorGrenade = "cmd/infinite-theater-3d build-weapons (halo-infinite-map-images, grenade projectile)"
	generatorSpartan = "cmd/infinite-theater-3d build-weapons (halo-infinite-map-images, spartan body)"
)
