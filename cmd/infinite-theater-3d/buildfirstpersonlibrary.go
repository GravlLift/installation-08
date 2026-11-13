package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/llampwall/infinite-theater-3d/internal/firstperson"
)

// runBuildFirstPersonLibrary builds the whole first-person library (every weapon the game
// renders in first person, the shared texture depot, the arm pieces catalog, and the
// index.json the viewer reads) into <data>/first-person.
func runBuildFirstPersonLibrary(args []string) error {
	fs := flag.NewFlagSet("build-firstperson-library", flag.ContinueOnError)
	gameRoot := fs.String("game", "", "game deploy root; empty auto-detects it (Steam, Xbox)")
	dataDir := fs.String("data", "", dataDirHelp)
	mapKey := fs.String("map", "", "any installed map's module key; its index covers the game's weapons and globals")
	if err := fs.Parse(args); err != nil {
		return err
	}
	dir, err := dataDirFor(*dataDir)
	if err != nil {
		return err
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx := context.Background()
	result, err := firstperson.Build(ctx, firstperson.Options{Map: *mapKey, GameRoot: *gameRoot, DataDir: dir},
		func(step string) { slog.InfoContext(ctx, "build step", "step", step) })
	if err != nil {
		return fmt.Errorf("build-firstperson-library: %w", err)
	}
	fmt.Printf("first-person library built into %s: %d built, %d skipped, %d bytes, %.1fs\n",
		dir, result.Built, result.Skipped, result.Bytes, result.Seconds)
	return nil
}
