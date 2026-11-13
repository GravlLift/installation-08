package meshbuild

// weapon.go resolves a weapon model's build target and writes its GLB.
//
// Ported from LevelUp's cmd/mapmesh-build/armes.go module resolution (AGPL-3.0, JGtm): a weapon
// model is read from any installed map's module index (weapons live in the game's
// `globals`/`common` modules, which every map's search path covers), so the caller names the map
// whose installed module to open the index from.

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// BuildWeaponOptions names a weapon model build's inputs.
type BuildWeaponOptions struct {
	// Weapon is the weapon's `weap` tag GlobalID: an 8-hex-digit string, optional "0x"/"0X"
	// prefix — the same form LevelUp's meshproto.CleArme resolves from a film's weapon
	// identifier, taken here directly rather than resolved from a replay.
	Weapon string
	// Map is any installed map's module key; its index covers the game's weapons.
	Map string
	// GameRoot is the game's deploy root; empty resolves it (himap.DeployRoot).
	GameRoot string
}

// BuildWeapon builds a weapon's GLB and writes it to `out`.
func BuildWeapon(ctx context.Context, opts BuildWeaponOptions, out string, announce func(mapmesh.Step)) (mapmesh.Summary, error) {
	gameRoot := opts.GameRoot
	if gameRoot == "" {
		root, err := himap.DeployRoot()
		if err != nil {
			return mapmesh.Summary{}, fmt.Errorf("game install: %w", err)
		}
		gameRoot = root
	}
	id, err := weaponID(opts.Weapon)
	if err != nil {
		return mapmesh.Summary{}, err
	}
	levelsDir := filepath.Join(gameRoot, "pc", "levels", "multi")
	module := modulePathIn(levelsDir, opts.Map)
	if module == "" {
		return mapmesh.Summary{}, fmt.Errorf("weapon %s: map %q is not installed", opts.Weapon, opts.Map)
	}
	target := mapmesh.WeaponTarget{Module: module, WeaponID: id, Key: opts.Weapon}
	return mapmesh.BuildWeapon(ctx, gameRoot, target, out, generatorTagWeapon, announce)
}

// weaponID parses a weapon key into its `weap` tag GlobalID (stringID, the shared 8-hex-digit
// StringID parser also used by build-piece and build-firstperson).
func weaponID(key string) (uint32, error) { return stringID(key, "weapon key") }

// generatorTagWeapon is written into every built weapon GLB's extras, naming the chain that
// produced it.
const generatorTagWeapon = "cmd/infinite-theater-3d build-weapon (halo-infinite-map-images, weapon model)"
