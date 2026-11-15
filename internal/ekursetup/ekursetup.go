// Package ekursetup builds the Ekur coating reference without Blender.
//
// The Ekur Blender add-on's "Dump Required Files" button only runs Ekur's standalone dumper
// (an exe published with each Ekur release, TheHaloArchive, GPL-3.0). This package does the
// same at the user's request: it downloads the pinned dumper release and verifies its size
// and SHA-256 against the constants below, downloads the three ReclaimerFiles lists the
// dumper reads, runs the dumper against the installed game into a temporary sibling of
// <data>/ekur, validates the JSON export with the coating builds' own contract
// (spartanpieces.EkurValid), and only then swaps it into place, so a failed run never
// leaves a half export where the builds read. Nothing is bundled: the dumper and the lists
// are fetched from their publishers and cached under <data>/tools/ekur.
//
// Queuing the coating library rebuilds afterwards is the caller's step (the server has the
// build queue; the CLI has none and says so).
package ekursetup

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// Pin names one downloadable executable and the size and SHA-256 (lowercase hex) it must
// have. A download that does not match is deleted and the setup fails.
type Pin struct {
	URL    string
	Name   string // the file name it is cached and run under
	Size   int64
	SHA256 string
}

// PinnedExe is the Ekur dumper release this program runs: Ekur 1.3.1's standalone exe, as
// its GitHub release lists it.
var PinnedExe = Pin{
	URL:    "https://github.com/TheHaloArchive/ekur/releases/download/1.3.1/ekur-1.3.1.exe",
	Name:   "ekur-1.3.1.exe",
	Size:   1_890_304,
	SHA256: "cfc436523d3e9637d85c60d7e07f8f83ac293576a87c9c6dfa0927a838440c32",
}

// ListsURL is where the three lists the dumper reads are published (ReclaimerFiles, master
// branch; the lists are not versioned, so they are not pinned by hash).
const ListsURL = "https://github.com/TheHaloArchive/ReclaimerFiles/raw/refs/heads/master/"

// The three lists, by file name.
const (
	StringsList  = "strings.txt"
	MapIDsList   = "map_ids.txt"
	ModelIDsList = "model_ids.txt"
)

// Lists are the three list file names, in download order.
var Lists = []string{StringsList, MapIDsList, ModelIDsList}

// Stage is one step of the setup, in the order Run reports them. StageQueuing is the
// caller's step after Run succeeds; it is named here so the server and the viewer share one
// vocabulary.
type Stage string

const (
	StageDownloading Stage = "downloading"
	StageVerifying   Stage = "verifying"
	StageDumping     Stage = "dumping"
	StageValidating  Stage = "validating"
	StageQueuing     Stage = "queuing"
)

// The failure kinds of a setup. Each error Run returns wraps exactly one of them, with a
// message that says what to do; none carries a token, and only the download errors carry a
// URL (the public publisher address).
var (
	ErrOverride      = errors.New(spartanpieces.EkurEnv + " is set and overrides the app's own Ekur export; unset it to use the coatings setup")
	ErrNoGame        = errors.New("no Halo Infinite install found: install the game through Steam or the Xbox app, or pass --game (or set " + himap.DeployRootEnv + ") to its deploy folder")
	ErrDownload      = errors.New("download failed")
	ErrHashMismatch  = errors.New("the downloaded Ekur dumper does not match the pinned release (size or SHA-256); it was deleted")
	ErrDumpFailed    = errors.New("the Ekur dumper failed")
	ErrInvalidOutput = errors.New("the Ekur dump is not a valid export")
	ErrSwap          = errors.New("the new Ekur export could not be moved into place")
)

// Options configure one setup run. DataDir and GameRoot are required; everything else has
// the production default when left zero (tests point the URLs at a local server).
type Options struct {
	DataDir  string
	GameRoot string // the game's deploy folder (ResolveGameRoot)

	Client   *http.Client // nil: a client with DownloadTimeout
	Exe      Pin          // zero: PinnedExe
	ListsURL string       // "": ListsURL; the list file names are appended to it

	// Log receives every stage line and the dumper's stdout and stderr, beside the
	// setup.log file Run always writes in the tools folder. nil: the file only.
	Log io.Writer
	// Progress is called at the start of each stage. nil: no calls.
	Progress func(Stage)
}

// Result is what a successful run produced.
type Result struct {
	ExportDir string // <data>/ekur
	Reused    bool   // the cached dumper was valid, no download was needed
}

// DownloadTimeout bounds each download with the default client.
const DownloadTimeout = 10 * time.Minute

// DumpTimeout bounds the dumper run, so a dumper that hangs cannot hold the job forever.
const DumpTimeout = 60 * time.Minute

// ToolsDir is where the dumper, the lists and the last run's log are cached.
func ToolsDir(dataDir string) string {
	return filepath.Join(dataDir, "tools", "ekur")
}

// LogName is the run log's file name in ToolsDir (rewritten by each run).
const LogName = "setup.log"

// ResolveGameRoot is the game deploy folder the dumper reads: the explicit folder when one
// is given (it must exist), else the install the rest of the program auto-detects
// (himap.DeployRoot: LEVELUP_HALO_DEPLOY, then the Steam libraries, then the Xbox app
// folders). It is the same root every one-time build opens its modules under
// (<deploy>/pc/..., <deploy>/any/...), which is the folder Ekur's --module-path names.
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

// Run performs one setup: refuse when the override variable is set, fetch and verify the
// dumper and the lists, run the dump into a temporary folder, validate it, and swap it into
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
	if opts.Exe == (Pin{}) {
		opts.Exe = PinnedExe
	}
	if opts.ListsURL == "" {
		opts.ListsURL = ListsURL
	}
	if opts.Client == nil {
		opts.Client = &http.Client{Timeout: DownloadTimeout}
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

	// Downloading: the dumper (unless the cached copy already verifies) and the lists.
	stage(StageDownloading)
	exe := filepath.Join(tools, opts.Exe.Name)
	reused := verifyFile(exe, opts.Exe) == nil
	if !reused {
		if err := download(ctx, opts.Client, opts.Exe.URL, exe, opts.Exe.Size+1); err != nil {
			return Result{}, err
		}
	}
	lists := make(map[string]string, len(Lists))
	for _, name := range Lists {
		p := filepath.Join(tools, name)
		lists[name] = p
		if info, err := os.Stat(p); err == nil && info.Mode().IsRegular() && info.Size() > 0 {
			continue // a cached list is complete: downloads land through a rename
		}
		if err := download(ctx, opts.Client, opts.ListsURL+name, p, maxListBytes); err != nil {
			return Result{}, err
		}
	}

	// Verifying: the file about to run is the pinned release, whether downloaded now or
	// cached by an earlier run.
	stage(StageVerifying)
	if err := verifyFile(exe, opts.Exe); err != nil {
		_ = os.Remove(exe)
		fmt.Fprintf(log, "verification failed: %v\n", err)
		return Result{}, fmt.Errorf("%w: %v", ErrHashMismatch, err)
	}

	// Dumping: into a fresh temporary sibling of <data>/ekur (same volume, so the swap is a
	// rename).
	stage(StageDumping)
	tmp, err := os.MkdirTemp(opts.DataDir, "ekur.setup-")
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
	dumpCtx, cancel := context.WithTimeout(ctx, DumpTimeout)
	defer cancel()
	args := DumperArgs(tmp, opts.GameRoot, lists[StringsList], lists[MapIDsList], lists[ModelIDsList])
	if err := runDumper(dumpCtx, exe, args, tools, log); err != nil {
		return Result{}, err
	}

	// Validating: the builds' own contract, the five JSON entries.
	stage(StageValidating)
	if missing := spartanpieces.EkurMissing(tmp); len(missing) > 0 {
		fmt.Fprintf(log, "dump is missing: %v\n", missing)
		return Result{}, fmt.Errorf("%w: it is missing %v (see %s in the data folder's tools\\ekur)", ErrInvalidOutput, missing, LogName)
	}

	dest := spartanpieces.DataEkurDir(opts.DataDir)
	if err := swapInto(tmp, dest, log); err != nil {
		return Result{}, err
	}
	keep = true
	fmt.Fprintf(log, "[%s] export ready\n", time.Now().Format(time.RFC3339))
	return Result{ExportDir: dest, Reused: reused}, nil
}

// DumperArgs is the dumper's command line for one run (Ekur's own flags; --skip-bitmaps
// because the coating builds read only the JSON side, and never --is-campaign).
func DumperArgs(savePath, modulePath, stringsPath, mapIDsPath, modelIDsPath string) []string {
	return []string{
		"--save-path", savePath,
		"--module-path", modulePath,
		"--strings-path", stringsPath,
		"--mapid-path", mapIDsPath,
		"--modelid-path", modelIDsPath,
		"--skip-bitmaps",
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
