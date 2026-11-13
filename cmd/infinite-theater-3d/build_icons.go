package main

// build_icons.go — the `build-icons` subcommand: build the weapon icon set (the PNG set
// and index.json) and the HUD equipment/grenade icon set (the 15 HUD PNGs and their
// index.json) from the game install into the data directory.

import (
	"context"
	"flag"
	"fmt"

	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// buildIconsFlags is the parsed form of the `build-icons` arguments.
type buildIconsFlags struct {
	dataDir string
	game    string
}

// parseBuildIconsFlags turns `build-icons` arguments into buildIconsFlags.
func parseBuildIconsFlags(args []string) (buildIconsFlags, error) {
	fs := flag.NewFlagSet("build-icons", flag.ContinueOnError)
	var f buildIconsFlags
	fs.StringVar(&f.dataDir, "data", "", "data directory (default: the IT3D_DATA_DIR env var or %LOCALAPPDATA%/infinite-theater-3d/data)")
	fs.StringVar(&f.game, "game", "", "game deploy root (empty auto-detects)")
	err := fs.Parse(args)
	if err != nil {
		return f, err
	}
	return f, nil
}

// runBuildIcons builds the weapon icon set and the HUD icon set into the data directory
// and prints the summary.
func runBuildIcons(args []string) error {
	f, err := parseBuildIconsFlags(args)
	if err != nil {
		return err
	}
	dataDir, err := dataDirFor(f.dataDir)
	if err != nil {
		return err
	}
	entries, n, err := weaponicons.Build(context.Background(), f.game, dataDir)
	if err != nil {
		return fmt.Errorf("build icons: %w", err)
	}
	fmt.Printf("%d entries, %d bytes -> %s\n", entries, n, weaponicons.OutDir(dataDir))
	files, named, n, err := weaponicons.BuildHud(context.Background(), f.game, dataDir)
	if err != nil {
		return fmt.Errorf("build hud icons: %w", err)
	}
	fmt.Printf("hud: %d files, %d named, %d bytes -> %s\n", files, named, n, weaponicons.HudOutDir(dataDir))
	return nil
}
