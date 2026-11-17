// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package ekursetup

// ekursetup_test.go — the setup end to end against a fake export only: an injectable
// export function writes a minimal valid export (or a broken one) into the temporary folder,
// so no test reaches a game install or the network.

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/llampwall/infinite-theater-3d/internal/ekurport"
	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// writeExport lays down the five contract entries in dir.
func writeExport(dir string) {
	for rel, body := range map[string]string{
		"materials/123.json":     `{}`,
		"stylelists/456.json":    `{}`,
		"styles/-177284589.json": `{}`,
		"globals.json":           `{"entries":{}}`,
		"visor_data.json":        `{"patterns":{},"colors":{}}`,
	} {
		p := filepath.Join(dir, filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			panic(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			panic(err)
		}
	}
}

// statsFor is the ExportStats a full fake export reports: one file per part.
var statsFor = ekurport.ExportStats{Globals: 1, Visor: 1, StyleLists: 1, Styles: 1, Materials: 1, Bytes: 100}

// setupFixture is one test's data directory, game folder (with its pc module folder) and
// options wired to the given export function.
func setupFixture(t *testing.T, export func(ctx context.Context, deployRoot, dir string) (ekurport.ExportStats, error)) (Options, *[]Stage) {
	t.Helper()
	t.Setenv(spartanpieces.EkurEnv, "")
	game := t.TempDir()
	if err := os.MkdirAll(filepath.Join(game, "pc"), 0o755); err != nil {
		t.Fatal(err)
	}
	var stages []Stage
	opts := Options{
		DataDir:  t.TempDir(),
		GameRoot: game,
		Export:   export,
		Progress: func(s Stage) { stages = append(stages, s) },
	}
	return opts, &stages
}

// leftovers lists the temporary export folders a run left in the data directory.
func leftovers(t *testing.T, dataDir string) []string {
	t.Helper()
	entries, err := os.ReadDir(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	var out []string
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), "ekur.setup-") || strings.HasSuffix(e.Name(), previousSuffix) {
			out = append(out, e.Name())
		}
	}
	return out
}

// TestRunSuccess — the full run: writes the export straight from the game, validates it and
// swaps it into <data>/ekur, with the stages in order and the export stats in the run log.
// A second run replaces the export in place without leaving the previous one behind.
func TestRunSuccess(t *testing.T) {
	export := func(ctx context.Context, deployRoot, dir string) (ekurport.ExportStats, error) {
		writeExport(dir)
		return statsFor, nil
	}
	opts, stages := setupFixture(t, export)

	res, err := Run(context.Background(), opts)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	want := spartanpieces.DataEkurDir(opts.DataDir)
	if res.ExportDir != want {
		t.Fatalf("result = %+v, want export %s", res, want)
	}
	if !spartanpieces.EkurValid(want) {
		t.Fatal("<data>/ekur is not a valid export after the run")
	}
	if got := spartanpieces.EkurDir(opts.DataDir); got != want {
		t.Fatalf("EkurDir = %q, want the new export", got)
	}
	if left := leftovers(t, opts.DataDir); len(left) > 0 {
		t.Fatalf("temporary folders left: %v", left)
	}
	if !slices.Equal(*stages, []Stage{StageExtracting, StageValidating}) {
		t.Fatalf("stages = %v", *stages)
	}

	logText, err := os.ReadFile(filepath.Join(ToolsDir(opts.DataDir), LogName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(logText), "exported 5 files, 100 bytes") {
		t.Fatalf("run log lacks the export stats line:\n%s", logText)
	}

	// The second run replaces the export in place.
	if _, err = Run(context.Background(), opts); err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if !spartanpieces.EkurValid(want) {
		t.Fatal("export invalid after the second run")
	}
	if left := leftovers(t, opts.DataDir); len(left) > 0 {
		t.Fatalf("folders left after the replacement: %v", left)
	}
}

// TestRunExportOnlyFiveParts — the swapped export keeps exactly the five contract entries
// (the port writes only those, so there is nothing to prune) and still stamps.
func TestRunExportOnlyFiveParts(t *testing.T) {
	export := func(ctx context.Context, deployRoot, dir string) (ekurport.ExportStats, error) {
		writeExport(dir)
		return statsFor, nil
	}
	opts, _ := setupFixture(t, export)
	res, err := Run(context.Background(), opts)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	entries, err := os.ReadDir(res.ExportDir)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range entries {
		names = append(names, e.Name())
	}
	slices.Sort(names)
	want := []string{"globals.json", "materials", "stylelists", "styles", "visor_data.json"}
	if !slices.Equal(names, want) {
		t.Fatalf("export entries = %v, want only %v", names, want)
	}
	if stamp, err := spartanpieces.EkurStamp(res.ExportDir); err != nil || stamp == "" {
		t.Fatalf("stamp of the export = %q, %v", stamp, err)
	}
}

// TestRunExportFailed — an export that fails leaves the previous export untouched, fails the
// run with the export's error, and leaves no temporary folder behind.
func TestRunExportFailed(t *testing.T) {
	export := func(ctx context.Context, deployRoot, dir string) (ekurport.ExportStats, error) {
		return ekurport.ExportStats{}, errors.New("could not open module index")
	}
	opts, _ := setupFixture(t, export)
	prev := spartanpieces.DataEkurDir(opts.DataDir)
	writeExport(prev)
	marker := filepath.Join(prev, "materials", "previous.json")
	if err := os.WriteFile(marker, []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Run(context.Background(), opts)
	if !strings.Contains(err.Error(), "could not open module index") {
		t.Fatalf("err = %v, want the export's error", err)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatal("previous export touched by a failed run")
	}
	if left := leftovers(t, opts.DataDir); len(left) > 0 {
		t.Fatalf("temporary folders left: %v", left)
	}
}

// TestRunInvalidOutput — an export that lacks contract entries fails validation, names what
// is missing, and never replaces <data>/ekur.
func TestRunInvalidOutput(t *testing.T) {
	export := func(ctx context.Context, deployRoot, dir string) (ekurport.ExportStats, error) {
		// Only materials: globals.json, visor_data.json, stylelists/, styles/ are absent.
		if err := os.MkdirAll(filepath.Join(dir, "materials"), 0o755); err != nil {
			return ekurport.ExportStats{}, err
		}
		if err := os.WriteFile(filepath.Join(dir, "materials", "123.json"), []byte(`{}`), 0o644); err != nil {
			return ekurport.ExportStats{}, err
		}
		return ekurport.ExportStats{}, nil
	}
	opts, stages := setupFixture(t, export)
	_, err := Run(context.Background(), opts)
	if !errors.Is(err, ErrInvalidOutput) {
		t.Fatalf("err = %v, want ErrInvalidOutput", err)
	}
	if !strings.Contains(err.Error(), "globals.json") {
		t.Fatalf("message %q does not name the missing entries", err)
	}
	if _, statErr := os.Stat(spartanpieces.DataEkurDir(opts.DataDir)); statErr == nil {
		t.Fatal("an invalid export was moved into place")
	}
	if left := leftovers(t, opts.DataDir); len(left) > 0 {
		t.Fatalf("temporary folders left: %v", left)
	}
	if (*stages)[len(*stages)-1] != StageValidating {
		t.Fatalf("stages = %v, want to end at validating", *stages)
	}
}

// TestRunOverride — with IT3D_EKUR_DIR set the run refuses before any export (the override
// would hide the app's own export from every build).
func TestRunOverride(t *testing.T) {
	exports := 0
	export := func(ctx context.Context, deployRoot, dir string) (ekurport.ExportStats, error) {
		exports++
		return statsFor, nil
	}
	opts, _ := setupFixture(t, export)
	t.Setenv(spartanpieces.EkurEnv, t.TempDir())
	if _, err := Run(context.Background(), opts); !errors.Is(err, ErrOverride) {
		t.Fatalf("err = %v, want ErrOverride", err)
	}
	if exports != 0 {
		t.Fatalf("export ran %d times under the override", exports)
	}
}

// TestRunNoGame — no game folder, or one without its pc module folder, fails as ErrNoGame
// before any export.
func TestRunNoGame(t *testing.T) {
	exports := 0
	export := func(ctx context.Context, deployRoot, dir string) (ekurport.ExportStats, error) {
		exports++
		return statsFor, nil
	}
	opts, _ := setupFixture(t, export)
	opts.GameRoot = ""
	if _, err := Run(context.Background(), opts); !errors.Is(err, ErrNoGame) {
		t.Fatalf("no game: err = %v, want ErrNoGame", err)
	}
	opts.GameRoot = t.TempDir()
	if _, err := Run(context.Background(), opts); !errors.Is(err, ErrNoGame) {
		t.Fatalf("no pc folder: err = %v, want ErrNoGame", err)
	}
	if exports != 0 {
		t.Fatalf("export ran %d times without a game", exports)
	}
}

// TestRunDefaultExport — a run with no injected export uses the game port, which fails
// cleanly on a game folder that is not a real install (no crash, no half export).
func TestRunDefaultExport(t *testing.T) {
	opts, _ := setupFixture(t, nil)
	_, err := Run(context.Background(), opts)
	if err == nil {
		t.Fatal("the game port ran on an empty game folder")
	}
	if _, statErr := os.Stat(spartanpieces.DataEkurDir(opts.DataDir)); statErr == nil {
		t.Fatal("an export appeared from the game port on an empty install")
	}
}

// TestResolveGameRootExplicit — an explicit folder must exist and hold pc/.
func TestResolveGameRootExplicit(t *testing.T) {
	if _, err := ResolveGameRoot(filepath.Join(t.TempDir(), "absent")); !errors.Is(err, ErrNoGame) {
		t.Fatalf("absent: err = %v", err)
	}
	noPC := t.TempDir()
	if _, err := ResolveGameRoot(noPC); !errors.Is(err, ErrNoGame) {
		t.Fatalf("no pc: err = %v", err)
	}
	deploy := t.TempDir()
	if err := os.MkdirAll(filepath.Join(deploy, "pc"), 0o755); err != nil {
		t.Fatal(err)
	}
	if got, err := ResolveGameRoot(deploy); err != nil || got != deploy {
		t.Fatalf("deploy: got %q, %v", got, err)
	}
}

// TestRemoveStaleTemps: a temporary export left by a killed run (unmodified for longer than
// staleTempAge) is removed; a recent one, which may be a live run in another process, and
// any other folder are kept.
func TestRemoveStaleTemps(t *testing.T) {
	data := t.TempDir()
	mk := func(name string, age time.Duration) string {
		p := filepath.Join(data, name)
		if err := os.MkdirAll(filepath.Join(p, "styles"), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(p, "globals.json"), []byte(`{}`), 0o644); err != nil {
			t.Fatal(err)
		}
		old := time.Now().Add(-age)
		if err := os.Chtimes(p, old, old); err != nil {
			t.Fatal(err)
		}
		return p
	}
	stale := mk(tempPrefix+"111", staleTempAge+time.Minute)
	live := mk(tempPrefix+"222", time.Minute)
	other := mk("ekur", staleTempAge+time.Hour)
	var log strings.Builder
	removeStaleTemps(data, &log)
	if _, err := os.Stat(stale); !os.IsNotExist(err) {
		t.Fatalf("stale temp still there (err %v); log: %s", err, log.String())
	}
	for _, p := range []string{live, other} {
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("%s was removed: %v", filepath.Base(p), err)
		}
	}
}
