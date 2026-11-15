package main

// setup_coatings.go — the `setup-coatings` subcommand: the same setup the viewer's
// "Set up coatings" button starts (internal/ekursetup), run from the command line. It
// writes the export straight from the installed game (no download, no external tool),
// validates it, and swaps it into <data>/ekur. There is no build queue here: the next
// `serve` start finds the new export and rebuilds the coating libraries.

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/llampwall/infinite-theater-3d/internal/ekursetup"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// runSetupCoatings runs the coatings setup once, printing each stage and the dumper's output.
func runSetupCoatings(args []string) error {
	fs := flag.NewFlagSet("setup-coatings", flag.ContinueOnError)
	dataFlag := fs.String("data", "", dataDirHelp)
	gameFlag := fs.String("game", "", "game deploy root; empty auto-detects it (LEVELUP_HALO_DEPLOY, Steam, Xbox)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	dataDir, err := dataDirFor(*dataFlag)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return fmt.Errorf("setup-coatings: data directory: %w", err)
	}
	// The variable wins over <data>/ekur, so a dump there would change nothing: say so first.
	if _, override := spartanpieces.EkurCandidate(dataDir); override {
		return fmt.Errorf("setup-coatings: %w", ekursetup.ErrOverride)
	}
	game, err := ekursetup.ResolveGameRoot(*gameFlag)
	if err != nil {
		return fmt.Errorf("setup-coatings: %w", err)
	}
	res, err := ekursetup.Run(context.Background(), ekursetup.Options{
		DataDir:  dataDir,
		GameRoot: game,
		Log:      os.Stderr,
		Progress: func(s ekursetup.Stage) { fmt.Fprintf(os.Stderr, "setup-coatings: %s\n", s) },
	})
	if err != nil {
		return fmt.Errorf("setup-coatings: %w", err)
	}
	fmt.Printf("Ekur export ready in %s.\n", res.ExportDir)
	fmt.Println("Start serve (restart it if it is running) to rebuild the coating libraries with it.")
	return nil
}
