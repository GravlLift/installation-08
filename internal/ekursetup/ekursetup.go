// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package ekursetup builds the Ekur coating reference the coating builders read.
//
// It reproduces, straight from the installed game (internal/ekurport), the five parts the
// builders read (globals.json, visor_data.json, stylelists/, styles/, materials/), writes
// them to a temporary sibling of <data>/ekur, validates the export with the coating builds'
// own contract (spartanpieces.EkurValid), and only then swaps it into place, so a failed run
// never leaves a half export where the builds read. A run refuses to start when the
// override variable is set (IT3D_EKUR_DIR) or when no game install can be found.
//
// Queuing the coating library rebuilds afterwards is the caller's step (the server has the
// build queue; the CLI has none and says so).
package ekursetup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/ekurport"
	"github.com/llampwall/infinite-theater-3d/internal/safefs"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// Stage is one step of the setup, in the order Run reports them. StageQueuing is the
// caller's step after Run succeeds; it is named here so the server and the viewer share one
// vocabulary.
type Stage string

const (
	StageExtracting Stage = "extracting"
	StageValidating Stage = "validating"
	StageQueuing    Stage = "queuing"
)

// The failure kinds of a setup. Each error Run returns wraps exactly one of them, with a
// message that says what to do; none carries a token.
var (
	ErrOverride      = errors.New(spartanpieces.EkurEnv + " is set and overrides the app's own Ekur export; unset it to use the coatings setup")
	ErrNoGame        = errors.New("no Halo Infinite install found: install the game through Steam or the Xbox app, or pass --game (or set " + himap.DeployRootEnv + ") to its deploy folder")
	ErrInvalidOutput = errors.New("the Ekur export is not a valid export")
	ErrSwap          = errors.New("the new Ekur export could not be moved into place")
)

// Options configure one setup run. DataDir and GameRoot are required; everything else has
// the production default when left zero.
type Options struct {
	DataDir  string
	GameRoot string // the game's deploy folder (ResolveGameRoot)

	// Export writes the five export parts under dir, read from the game deployRoot. nil:
	// the game port (ekurport.WriteExport). Tests inject a fake that writes a minimal
	// valid export, so no game and no network are needed.
	Export func(ctx context.Context, deployRoot, dir string) (ekurport.ExportStats, error)

	// Log receives every stage line, beside the setup.log file Run always writes in the
	// tools folder. nil: the file only.
	Log io.Writer
	// Progress is called at the start of each stage. nil: no calls.
	Progress func(Stage)
}

// Result is what a successful run produced.
type Result struct {
	ExportDir string // <data>/ekur
}

// ToolsDir is where the last run's log is kept.
func ToolsDir(dataDir string) string {
	return filepath.Join(dataDir, "tools", "ekur")
}

// LogName is the run log's file name in ToolsDir (rewritten by each run).
const LogName = "setup.log"

// ResolveGameRoot is the game deploy folder the port reads: the explicit folder when one
// is given (it must exist), else the install the rest of the program auto-detects
// (himap.DeployRoot: LEVELUP_HALO_DEPLOY, then the Steam libraries, then the Xbox app
// folders). It is the same root every one-time build opens its modules under
// (<deploy>/pc/..., <deploy>/any/...).
func ResolveGameRoot(explicit string) (string, error) {
	root := explicit
	if root == "" {
		found, err := himap.DeployRoot()
		if err != nil {
			return "", ErrNoGame
		}
		root = found
	}
	if !isDir(root) {
		return "", ErrNoGame
	}
	// Every build reads the game's PC modules under <deploy>/pc: a folder without it is not
	// the deploy folder (a wrong --game, or the install's parent folder).
	if !isDir(filepath.Join(root, "pc")) {
		return "", fmt.Errorf("%w (the folder given has no pc module folder; it must be the install's deploy folder)", ErrNoGame)
	}
	return root, nil
}

// Run performs one setup: refuse when the override variable is set, write the export
// straight from the game into a temporary folder, validate it, and swap it into
// <data>/ekur. On any failure the previous <data>/ekur (if any) is left as it was.
func Run(ctx context.Context, opts Options) (Result, error) {
	if os.Getenv(spartanpieces.EkurEnv) != "" {
		return Result{}, ErrOverride
	}
	if opts.DataDir == "" {
		return Result{}, errors.New("ekursetup: no data directory")
	}
	if opts.GameRoot == "" || !isDir(filepath.Join(opts.GameRoot, "pc")) {
		return Result{}, ErrNoGame
	}
	export := opts.Export
	if export == nil {
		export = ekurport.WriteExport
	}
	progress := opts.Progress
	if progress == nil {
		progress = func(Stage) {}
	}

	tools := ToolsDir(opts.DataDir)
	if err := os.MkdirAll(tools, 0o755); err != nil {
		return Result{}, fmt.Errorf("ekursetup: tools folder: %w", err)
	}
	logFile, err := os.Create(filepath.Join(tools, LogName))
	if err != nil {
		return Result{}, fmt.Errorf("ekursetup: run log: %w", err)
	}
	defer logFile.Close()
	log := io.Writer(logFile)
	if opts.Log != nil {
		log = io.MultiWriter(logFile, opts.Log)
	}
	stage := func(s Stage) {
		fmt.Fprintf(log, "[%s] stage: %s\n", time.Now().Format(time.RFC3339), s)
		progress(s)
	}

	// Extracting: straight from the game, into a fresh temporary sibling of <data>/ekur
	// (same volume, so the swap is a rename). The port writes only the five parts the
	// builders read, so there is nothing to prune.
	stage(StageExtracting)
	removeStaleTemps(opts.DataDir, log)
	tmp, err := os.MkdirTemp(opts.DataDir, tempPrefix)
	if err != nil {
		return Result{}, fmt.Errorf("ekursetup: temporary export folder: %w", err)
	}
	keep := false
	defer func() {
		if !keep {
			if err := removeTree(tmp, "temporary Ekur export"); err != nil {
				fmt.Fprintf(log, "temporary export left in place: %v\n", err)
			}
		}
	}()
	stats, err := export(ctx, opts.GameRoot, tmp)
	if err != nil {
		return Result{}, fmt.Errorf("the Ekur export failed: %v (see %s in the data folder's tools\\ekur)", err, LogName)
	}
	files := stats.Globals + stats.Visor + stats.StyleLists + stats.Styles + stats.Materials
	fmt.Fprintf(log, "exported %d files, %d bytes (globals %d, visor %d, stylelists %d, styles %d, materials %d)\n",
		files, stats.Bytes, stats.Globals, stats.Visor, stats.StyleLists, stats.Styles, stats.Materials)

	// Validating: the builds' own contract, the five JSON entries.
	stage(StageValidating)
	if missing := spartanpieces.EkurMissing(tmp); len(missing) > 0 {
		fmt.Fprintf(log, "export is missing: %v\n", missing)
		return Result{}, fmt.Errorf("%w: it is missing %v (see %s in the data folder's tools\\ekur)", ErrInvalidOutput, missing, LogName)
	}

	dest := spartanpieces.DataEkurDir(opts.DataDir)
	if err := swapInto(tmp, dest, log); err != nil {
		return Result{}, err
	}
	keep = true
	fmt.Fprintf(log, "[%s] export ready\n", time.Now().Format(time.RFC3339))
	return Result{ExportDir: dest}, nil
}

// removeTree removes a folder this package created or replaced, never following a symlink
// or junction.
func removeTree(path, what string) error {
	return safefs.RemoveTree(path, what)
}

// tempPrefix names the temporary export folders a run writes beside <data>/ekur.
const tempPrefix = "ekur.setup-"

// staleTempAge is how long a temporary export folder must have gone unmodified before a
// new run treats it as left behind by a run that was killed (its window closed mid-setup).
// A live run finishes in well under a minute.
const staleTempAge = 10 * time.Minute

// removeStaleTemps removes the temporary export folders a killed run left in dataDir (a
// clean failure removes its own). A folder modified within staleTempAge may belong to a run
// in another process and is kept. Refused removals are logged and left behind.
func removeStaleTemps(dataDir string, log io.Writer) {
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		return
	}
	for _, e := range entries {
		if !e.IsDir() || !strings.HasPrefix(e.Name(), tempPrefix) {
			continue
		}
		info, err := e.Info()
		if err != nil || time.Since(info.ModTime()) < staleTempAge {
			continue
		}
		p := filepath.Join(dataDir, e.Name())
		if err := removeTree(p, "stale temporary export"); err != nil {
			fmt.Fprintf(log, "[%s] could not remove a stale temporary export %s: %v\n", time.Now().Format(time.RFC3339), e.Name(), err)
		}
	}
}

// previousSuffix names the folder the old export is moved to while the new one takes its
// place; it is removed once the swap succeeded.
const previousSuffix = ".previous"

// swapInto moves the validated export tmp to dest. An existing dest (a folder, or a link
// the user made) is moved aside first and put back if the final rename fails; once the new
// export is in place the old one is removed, never following a symlink or junction (a link
// is unlinked, its target untouched). A removal that is refused is logged and left behind.
func swapInto(tmp, dest string, log io.Writer) error {
	prev := dest + previousSuffix
	_, statErr := os.Lstat(dest)
	hadDest := statErr == nil
	if hadDest {
		if err := removeTree(prev, "previous Ekur export"); err != nil {
			return fmt.Errorf("%w: an older %s folder could not be removed: %v", ErrSwap, filepath.Base(prev), err)
		}
		if err := os.Rename(dest, prev); err != nil {
			return fmt.Errorf("%w: the current export could not be moved aside (is a build reading it?): %v", ErrSwap, err)
		}
	}
	if err := os.Rename(tmp, dest); err != nil {
		if hadDest {
			if rerr := os.Rename(prev, dest); rerr != nil {
				fmt.Fprintf(log, "previous export could not be restored: %v\n", rerr)
			}
		}
		return fmt.Errorf("%w: %v", ErrSwap, err)
	}
	if hadDest {
		if err := removeTree(prev, "previous Ekur export"); err != nil {
			fmt.Fprintf(log, "previous export left in place: %v\n", err)
		}
	}
	return nil
}

func isDir(p string) bool {
	info, err := os.Stat(p)
	return err == nil && info.IsDir()
}
