package meshbuild

// piece.go resolves a single Spartan armor piece's build target and writes its GLB.
//
// Ported from LevelUp's cmd/mapmesh-build module resolution for the pieces library (AGPL-3.0,
// JGtm): the Spartan render_model lives in the game's shared `globals`/`common` modules, so the
// caller names the map whose installed module to open the index from (same pattern as
// BuildWeapon and BuildSpartan).

import (
	"context"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// BuildPieceOptions names an armor piece build's inputs.
type BuildPieceOptions struct {
	// Region and Permutation are the piece's key: 8-hex-digit StringIDs, optional "0x" prefix.
	Region, Permutation string
	// Map is any installed map's module key; its index covers the game's globals.
	Map string
	// GameRoot is the game's deploy root; empty resolves it the way build-mesh does.
	GameRoot string
}

// BuildPiece builds one Spartan armor piece's GLB and writes it to `out`.
func BuildPiece(ctx context.Context, opts BuildPieceOptions, out string, announce func(mapmesh.Step)) (mapmesh.Summary, error) {
	gameRoot := opts.GameRoot
	if gameRoot == "" {
		root, err := himap.DeployRoot()
		if err != nil {
			return mapmesh.Summary{}, fmt.Errorf("game install: %w", err)
		}
		gameRoot = root
	}
	region, err := stringID(opts.Region, "region")
	if err != nil {
		return mapmesh.Summary{}, err
	}
	permutation, err := stringID(opts.Permutation, "permutation")
	if err != nil {
		return mapmesh.Summary{}, err
	}
	levelsDir := filepath.Join(gameRoot, "pc", "levels", "multi")
	module := modulePathIn(levelsDir, opts.Map)
	if module == "" {
		return mapmesh.Summary{}, fmt.Errorf("piece %08x-%08x: map %q is not installed", region, permutation, opts.Map)
	}
	target := mapmesh.PieceTarget{Module: module, Region: region, Permutation: permutation}
	return mapmesh.BuildPiece(ctx, gameRoot, target, out, generatorTagPiece, announce)
}

// stringID parses an 8-hex-digit StringID (optional "0x" prefix), as weaponID does for a weapon
// `weap` tag GlobalID.
func stringID(key, what string) (uint32, error) {
	hex := key
	if len(hex) >= 2 && strings.EqualFold(hex[:2], "0x") {
		hex = hex[2:]
	}
	if len(hex) != 8 {
		return 0, fmt.Errorf("%s %q: want 8 hex digits", what, key)
	}
	id, err := strconv.ParseUint(hex, 16, 32)
	if err != nil {
		return 0, fmt.Errorf("%s %q: %w", what, key, err)
	}
	return uint32(id), nil
}

// generatorTagPiece is written into every built armor piece GLB's extras, naming the chain that
// produced it.
const generatorTagPiece = "cmd/infinite-theater-3d build-piece (halo-infinite-map-images, armor piece)"
