package meshbuild

// firstperson.go resolves a weapon's first-person rig build target and writes its GLB.
//
// Ported from LevelUp's cmd/mapmesh-build module resolution for the first-person rigs library
// (AGPL-3.0, JGtm): weapons and the Spartan's arms live in the game's shared `globals`/`common`
// modules, so the caller names the map whose installed module to open the index from (same
// pattern as BuildWeapon, BuildSpartan and BuildPiece).

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// BuildFirstPersonOptions names a first-person rig build's inputs.
type BuildFirstPersonOptions struct {
	// Weapon is the weapon's `weap` tag GlobalID: an 8-hex-digit string, optional "0x" prefix.
	Weapon string
	// Map is any installed map's module key; its index covers the game's weapons and globals.
	Map string
	// GameRoot is the game's deploy root; empty resolves it the way build-mesh does.
	GameRoot string
	// NoArms keeps the skeleton and clips without the arm geometry.
	NoArms bool
}

// BuildFirstPerson builds a weapon's first-person rig GLB and writes it to `out`.
func BuildFirstPerson(ctx context.Context, opts BuildFirstPersonOptions, out string, announce func(mapmesh.Step)) (mapmesh.Summary, error) {
	gameRoot := opts.GameRoot
	if gameRoot == "" {
		root, err := himap.DeployRoot()
		if err != nil {
			return mapmesh.Summary{}, fmt.Errorf("game install: %w", err)
		}
		gameRoot = root
	}
	id, err := stringID(opts.Weapon, "weapon key")
	if err != nil {
		return mapmesh.Summary{}, err
	}
	levelsDir := filepath.Join(gameRoot, "pc", "levels", "multi")
	module := modulePathIn(levelsDir, opts.Map)
	if module == "" {
		return mapmesh.Summary{}, fmt.Errorf("first-person rig %s: map %q is not installed", opts.Weapon, opts.Map)
	}
	target := mapmesh.FirstPersonTarget{Module: module, WeaponID: id, Key: opts.Weapon, NoArms: opts.NoArms}
	return mapmesh.BuildFirstPerson(ctx, gameRoot, target, out, generatorTagFirstPerson, announce)
}

// generatorTagFirstPerson is written into every built first-person rig GLB's extras, naming the
// chain that produced it.
const generatorTagFirstPerson = "cmd/infinite-theater-3d build-firstperson (halo-infinite-map-images, first-person rig)"
