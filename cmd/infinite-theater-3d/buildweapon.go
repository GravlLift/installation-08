// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/llampwall/infinite-theater-3d/internal/mapmesh"
	"github.com/llampwall/infinite-theater-3d/internal/meshbuild"
)

// runBuildWeapon builds one weapon's static model from the local game installation and writes it
// to a GLB file.
func runBuildWeapon(args []string) error {
	fs := flag.NewFlagSet("build-weapon", flag.ContinueOnError)
	weapon := fs.String("weapon", "", "weapon's weap tag GlobalID (8 hex digits, optional 0x prefix)")
	mapKey := fs.String("map", "", "any installed map's module key; its index covers the game's weapons")
	gameRoot := fs.String("game", "", "game deploy root; empty auto-detects it (LEVELUP_HALO_DEPLOY, Steam, Xbox)")
	out := fs.String("out", "", "GLB file to write")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *weapon == "" || *mapKey == "" || *out == "" {
		return fmt.Errorf("build-weapon: --weapon, --map and --out are required")
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx := context.Background()
	opts := meshbuild.BuildWeaponOptions{Weapon: *weapon, Map: *mapKey, GameRoot: *gameRoot}
	summary, err := meshbuild.BuildWeapon(ctx, opts, *out, func(step mapmesh.Step) {
		slog.InfoContext(ctx, "build step", "weapon", *weapon, "step", step)
	})
	if err != nil {
		return fmt.Errorf("build-weapon: %w", err)
	}
	fmt.Printf("wrote %s: %d bytes, %d triangles\n", *out, summary.Bytes, summary.Triangles)
	return nil
}
