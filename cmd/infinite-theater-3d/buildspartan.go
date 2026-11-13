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

// runBuildSpartan builds the Spartan body (default armor, body animations baked on) from the
// local game installation and writes it to a GLB file.
func runBuildSpartan(args []string) error {
	fs := flag.NewFlagSet("build-spartan", flag.ContinueOnError)
	mapKey := fs.String("map", "", "any installed map's module key; its index covers the game's globals")
	gameRoot := fs.String("game", "", "game deploy root; empty auto-detects it (LEVELUP_HALO_DEPLOY, Steam, Xbox)")
	out := fs.String("out", "", "GLB file to write")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *mapKey == "" || *out == "" {
		return fmt.Errorf("build-spartan: --map and --out are required")
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx := context.Background()
	opts := meshbuild.BuildSpartanOptions{Map: *mapKey, GameRoot: *gameRoot}
	summary, err := meshbuild.BuildSpartan(ctx, opts, *out, func(step mapmesh.Step) {
		slog.InfoContext(ctx, "build step", "map", *mapKey, "step", step)
	})
	if err != nil {
		return fmt.Errorf("build-spartan: %w", err)
	}
	fmt.Printf("wrote %s: %d bytes, %d triangles\n", *out, summary.Bytes, summary.Triangles)
	return nil
}
