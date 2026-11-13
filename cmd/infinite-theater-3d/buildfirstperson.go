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

// runBuildFirstPerson builds one weapon's first-person rig (arms, weapon and animation clips)
// from the local game installation and writes it to a GLB file.
func runBuildFirstPerson(args []string) error {
	fs := flag.NewFlagSet("build-firstperson", flag.ContinueOnError)
	weapon := fs.String("weapon", "", "weapon's weap tag GlobalID (8 hex digits, optional 0x prefix)")
	mapKey := fs.String("map", "", "any installed map's module key; its index covers the game's weapons and globals")
	gameRoot := fs.String("game", "", "game deploy root; empty auto-detects it (LEVELUP_HALO_DEPLOY, Steam, Xbox)")
	noArms := fs.Bool("no-arms", false, "keep the skeleton and clips without the Spartan's arm geometry")
	out := fs.String("out", "", "GLB file to write")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *weapon == "" || *mapKey == "" || *out == "" {
		return fmt.Errorf("build-firstperson: --weapon, --map and --out are required")
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx := context.Background()
	opts := meshbuild.BuildFirstPersonOptions{Weapon: *weapon, Map: *mapKey, GameRoot: *gameRoot, NoArms: *noArms}
	summary, err := meshbuild.BuildFirstPerson(ctx, opts, *out, func(step mapmesh.Step) {
		slog.InfoContext(ctx, "build step", "weapon", *weapon, "step", step)
	})
	if err != nil {
		return fmt.Errorf("build-firstperson: %w", err)
	}
	fmt.Printf("wrote %s: %d bytes, %d triangles\n", *out, summary.Bytes, summary.Triangles)
	return nil
}
