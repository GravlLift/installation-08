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

// runBuildPiece builds one Spartan armor piece's model from the local game installation and
// writes it to a GLB file.
func runBuildPiece(args []string) error {
	fs := flag.NewFlagSet("build-piece", flag.ContinueOnError)
	region := fs.String("region", "", "piece's armor region StringID (8 hex digits, optional 0x prefix)")
	permutation := fs.String("permutation", "", "piece's permutation StringID (8 hex digits, optional 0x prefix)")
	mapKey := fs.String("map", "", "any installed map's module key; its index covers the game's globals")
	gameRoot := fs.String("game", "", "game deploy root; empty auto-detects it (LEVELUP_HALO_DEPLOY, Steam, Xbox)")
	out := fs.String("out", "", "GLB file to write")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *region == "" || *permutation == "" || *mapKey == "" || *out == "" {
		return fmt.Errorf("build-piece: --region, --permutation, --map and --out are required")
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx := context.Background()
	opts := meshbuild.BuildPieceOptions{Region: *region, Permutation: *permutation, Map: *mapKey, GameRoot: *gameRoot}
	summary, err := meshbuild.BuildPiece(ctx, opts, *out, func(step mapmesh.Step) {
		slog.InfoContext(ctx, "build step", "region", *region, "permutation", *permutation, "step", step)
	})
	if err != nil {
		return fmt.Errorf("build-piece: %w", err)
	}
	fmt.Printf("wrote %s: %d bytes, %d triangles\n", *out, summary.Bytes, summary.Triangles)
	return nil
}
