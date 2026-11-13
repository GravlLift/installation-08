package mapmesh

// weapon.go ports LevelUp's internal/mapmesh/armes.go (AGPL-3.0, JGtm) weapon-model build: a
// static glTF mesh of one weapon's model (himap.Arsenal), read from the game's common modules
// via the index of any installed map (weapons live in the `globals`/`common` modules, which
// every map's module search path covers; a model built once serves every match). No animation:
// LevelUp bakes animation clips only onto the Spartan rig, which this builder does not port.

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// WeaponTarget is a weapon (or grenade projectile) model to build.
type WeaponTarget struct {
	// Module is the `.module` of any installed map whose index covers the game's weapons.
	Module string
	// WeaponID is the weapon's `weap` tag GlobalID.
	WeaponID uint32
	// Key is published in the GLB's extras (the hex id, or a friendlier name the caller knows).
	Key string
}

// BuildWeapon writes the weapon's GLB to `path`, built in-process from the local game
// installation. `announce` (nil accepted) receives each step at its start.
func BuildWeapon(ctx context.Context, gameRoot string, t WeaponTarget, path, generator string, announce func(Step)) (Summary, error) {
	if announce == nil {
		announce = func(Step) {}
	}
	announce(StepGeometry)
	a, err := himap.OuvreArsenal(gameRoot, t.Module)
	if err != nil {
		return Summary{}, err
	}
	defer func() {
		if err := a.Close(); err != nil {
			slog.WarnContext(ctx, "closing arsenal", "err", err)
		}
	}()
	m, err := a.Arme(ctx, t.WeaponID)
	if err != nil {
		return Summary{}, err
	}
	announce(StepWriting)
	extras := map[string]any{"weapon": t.Key, axesGLBKey: axesGLB}
	n, err := writeFile(path, func(w io.Writer) error { return himap.EcritGLB(w, m, generator, extras) })
	if err != nil {
		return Summary{}, err
	}
	s := Summary{Triangles: m.Structure.Triangles(), Bytes: n}
	slog.InfoContext(ctx, "weapon model written", "weapon", t.Key, "triangles", s.Triangles, "bytes", n, "file", filepath.Base(path))
	return s, nil
}
