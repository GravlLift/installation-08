package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/llampwall/infinite-theater-3d/internal/weapons"
)

// runBuildWeapons builds the whole weapon model library (every weapon in the installed game's
// roster, the grenade projectiles, and the Spartan body) into <data>/weapons, writing the
// index.json the viewer reads.
func runBuildWeapons(args []string) error {
	fs := flag.NewFlagSet("build-weapons", flag.ContinueOnError)
	gameRoot := fs.String("game", "", "game deploy root; empty auto-detects it (Steam, Xbox)")
	dataDir := fs.String("data", "", dataDirHelp)
	mapKey := fs.String("map", "", "any installed map's module key; its index covers the game's weapons")
	if err := fs.Parse(args); err != nil {
		return err
	}
	dir, err := dataDirFor(*dataDir)
	if err != nil {
		return err
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, nil)))
	ctx := context.Background()

	catalog, err := weapons.Discover(ctx, *mapKey, *gameRoot)
	if err != nil {
		return fmt.Errorf("build-weapons: discover: %w", err)
	}
	slog.InfoContext(ctx, "weapon roster discovered", "map", catalog.Map, "weapons", len(catalog.Keys))
	result, err := weapons.Build(ctx, weapons.Options{Catalog: catalog, GameRoot: *gameRoot, DataDir: dir},
		func(step string) { slog.InfoContext(ctx, "build step", "step", step) })
	if err != nil {
		return fmt.Errorf("build-weapons: %w", err)
	}
	fmt.Printf("weapons built into %s: %d built, %d skipped, %d bytes, %.1fs\n",
		dir, result.Built, result.Skipped, result.Bytes, result.Seconds)
	return nil
}
