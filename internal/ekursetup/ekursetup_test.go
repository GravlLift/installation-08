package ekursetup

// ekursetup_test.go — the setup end to end against fakes only: a local httptest server
// stands in for GitHub (it serves this test binary as the "dumper" and three small lists),
// and the test binary re-executed with fakeDumperEnv set plays the dumper (TestMain). No
// test reaches the network or a game install.

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/spartanpieces"
)

// fakeDumperEnv switches the test binary into the fake dumper: "ok" writes a full export,
// "fail" prints an error and exits 3, "partial" writes only materials/.
const fakeDumperEnv = "EKURSETUP_FAKE_DUMPER"

// fakeArgsEnv names a file the fake dumper writes its command line to (one arg per line).
const fakeArgsEnv = "EKURSETUP_FAKE_ARGS_OUT"

func TestMain(m *testing.M) {
	if mode := os.Getenv(fakeDumperEnv); mode != "" {
		os.Exit(fakeDumper(mode, os.Args[1:]))
	}
	os.Exit(m.Run())
}

// fakeDumper is the dumper's stand-in: it checks the command line the way Ekur reads it
// (every path flag present and readable, --skip-bitmaps given, --is-campaign never) and
// then behaves as mode says.
func fakeDumper(mode string, args []string) int {
	if out := os.Getenv(fakeArgsEnv); out != "" {
		_ = os.WriteFile(out, []byte(strings.Join(args, "\n")), 0o644)
	}
	flags := map[string]string{}
	skipBitmaps := false
	for i := 0; i < len(args); i++ {
		switch a := args[i]; a {
		case "--skip-bitmaps":
			skipBitmaps = true
		case "--is-campaign":
			fmt.Fprintln(os.Stderr, "fake dumper: --is-campaign must never be passed")
			return 9
		default:
			if !strings.HasPrefix(a, "--") || i+1 >= len(args) {
				fmt.Fprintln(os.Stderr, "fake dumper: bad argument", a)
				return 8
			}
			flags[a] = args[i+1]
			i++
		}
	}
	for _, f := range []string{"--save-path", "--module-path", "--strings-path", "--mapid-path", "--modelid-path"} {
		if flags[f] == "" {
			fmt.Fprintln(os.Stderr, "fake dumper: missing", f)
			return 7
		}
	}
	if !skipBitmaps {
		fmt.Fprintln(os.Stderr, "fake dumper: --skip-bitmaps missing")
		return 6
	}
	for _, f := range []string{"--strings-path", "--mapid-path", "--modelid-path"} {
		if _, err := os.ReadFile(flags[f]); err != nil {
			fmt.Fprintln(os.Stderr, "fake dumper: list unreadable:", err)
			return 5
		}
	}
	save := flags["--save-path"]
	fmt.Println("Loading modules")
	switch mode {
	case "fail":
		fmt.Fprintln(os.Stderr, "error: could not open module index")
		return 3
	case "partial":
		_ = os.MkdirAll(filepath.Join(save, "materials"), 0o755)
		fmt.Println("Dumped 0 styles")
		return 0
	}
	writeExport(save)
	fmt.Println("Dumped 1 material")
	return 0
}

// writeExport lays down the five contract entries in folder.
func writeExport(folder string) {
	for rel, body := range map[string]string{
		"materials/123.json":     `{}`,
		"stylelists/456.json":    `{}`,
		"styles/-177284589.json": `{}`,
		"globals.json":           `{"entries":{}}`,
		"visor_data.json":        `{"patterns":{},"colors":{}}`,
	} {
		p := filepath.Join(folder, filepath.FromSlash(rel))
		_ = os.MkdirAll(filepath.Dir(p), 0o755)
		_ = os.WriteFile(p, []byte(body), 0o644)
	}
}

// fakeHost is the stand-in for GitHub: the dumper at /ekur.exe and the lists under /lists/.
type fakeHost struct {
	srv      *httptest.Server
	pin      Pin
	mu       sync.Mutex
	requests map[string]int
	missing  map[string]bool // paths answered 404
}

func newFakeHost(t *testing.T) *fakeHost {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	exe, err := os.ReadFile(self)
	if err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(exe)
	h := &fakeHost{requests: map[string]int{}, missing: map[string]bool{}}
	h.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h.mu.Lock()
		h.requests[r.URL.Path]++
		gone := h.missing[r.URL.Path]
		h.mu.Unlock()
		switch {
		case gone:
			http.NotFound(w, r)
		case r.URL.Path == "/ekur.exe":
			_, _ = w.Write(exe)
		case strings.HasPrefix(r.URL.Path, "/lists/"):
			fmt.Fprintf(w, "list %s\n", strings.TrimPrefix(r.URL.Path, "/lists/"))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(h.srv.Close)
	h.pin = Pin{URL: h.srv.URL + "/ekur.exe", Name: PinnedExe.Name, Size: int64(len(exe)), SHA256: hex.EncodeToString(sum[:])}
	return h
}

func (h *fakeHost) count(path string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.requests[path]
}

// setupFixture is one test's data directory, game folder (with its pc module folder) and
// options pointed at the fake host, the fake dumper in mode.
func setupFixture(t *testing.T, mode string) (*fakeHost, Options, *[]Stage) {
	t.Helper()
	t.Setenv(spartanpieces.EkurEnv, "")
	t.Setenv(fakeDumperEnv, mode)
	host := newFakeHost(t)
	game := t.TempDir()
	if err := os.MkdirAll(filepath.Join(game, "pc"), 0o755); err != nil {
		t.Fatal(err)
	}
	var stages []Stage
	opts := Options{
		DataDir:  t.TempDir(),
		GameRoot: game,
		Client:   host.srv.Client(),
		Exe:      host.pin,
		ListsURL: host.srv.URL + "/lists/",
		Progress: func(s Stage) { stages = append(stages, s) },
	}
	return host, opts, &stages
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

// TestRunSuccess — the full run: downloads, verifies, dumps with the right command line,
// validates and swaps the export into <data>/ekur, with the stages in order and the dumper's
// output in the run log. A second run reuses the cached dumper and lists and replaces the
// export without leaving the previous one behind.
func TestRunSuccess(t *testing.T) {
	host, opts, stages := setupFixture(t, "ok")
	argsOut := filepath.Join(t.TempDir(), "args.txt")
	t.Setenv(fakeArgsEnv, argsOut)

	res, err := Run(context.Background(), opts)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	want := spartanpieces.DataEkurDir(opts.DataDir)
	if res.ExportDir != want || res.Reused {
		t.Fatalf("result = %+v, want export %s, not reused", res, want)
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
	if !slices.Equal(*stages, []Stage{StageDownloading, StageVerifying, StageDumping, StageValidating}) {
		t.Fatalf("stages = %v", *stages)
	}

	raw, err := os.ReadFile(argsOut)
	if err != nil {
		t.Fatal(err)
	}
	args := strings.Split(string(raw), "\n")
	tools := ToolsDir(opts.DataDir)
	wantArgs := []string{
		"--module-path", opts.GameRoot,
		"--strings-path", filepath.Join(tools, StringsList),
		"--mapid-path", filepath.Join(tools, MapIDsList),
		"--modelid-path", filepath.Join(tools, ModelIDsList),
	}
	for i := 0; i < len(wantArgs); i += 2 {
		j := slices.Index(args, wantArgs[i])
		if j < 0 || j+1 >= len(args) || args[j+1] != wantArgs[i+1] {
			t.Fatalf("dumper args %v: want %s %s", args, wantArgs[i], wantArgs[i+1])
		}
	}
	if !slices.Contains(args, "--skip-bitmaps") || slices.Contains(args, "--is-campaign") {
		t.Fatalf("dumper args %v: want --skip-bitmaps and never --is-campaign", args)
	}

	logText, err := os.ReadFile(filepath.Join(tools, LogName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(logText), "Dumped 1 material") {
		t.Fatalf("run log lacks the dumper's output:\n%s", logText)
	}

	// The second run: cached dumper and lists, export replaced in place.
	res, err = Run(context.Background(), opts)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if !res.Reused {
		t.Fatal("second run downloaded the dumper again")
	}
	if n := host.count("/ekur.exe"); n != 1 {
		t.Fatalf("dumper downloaded %d times, want 1", n)
	}
	if n := host.count("/lists/" + StringsList); n != 1 {
		t.Fatalf("strings list downloaded %d times, want 1", n)
	}
	if !spartanpieces.EkurValid(want) {
		t.Fatal("export invalid after the second run")
	}
	if left := leftovers(t, opts.DataDir); len(left) > 0 {
		t.Fatalf("folders left after the replacement: %v", left)
	}
}

// TestRunHashMismatch — a dumper that does not match the pin (wrong SHA-256, or wrong size)
// is deleted and the run fails before anything runs; no export appears.
func TestRunHashMismatch(t *testing.T) {
	for name, mutate := range map[string]func(*Pin){
		"sha256": func(p *Pin) { p.SHA256 = strings.Repeat("0", 64) },
		"size":   func(p *Pin) { p.Size-- },
	} {
		t.Run(name, func(t *testing.T) {
			_, opts, stages := setupFixture(t, "ok")
			mutate(&opts.Exe)
			_, err := Run(context.Background(), opts)
			if !errors.Is(err, ErrHashMismatch) {
				t.Fatalf("err = %v, want ErrHashMismatch", err)
			}
			if _, statErr := os.Stat(filepath.Join(ToolsDir(opts.DataDir), opts.Exe.Name)); statErr == nil {
				t.Fatal("mismatched dumper left on disk")
			}
			if _, statErr := os.Stat(spartanpieces.DataEkurDir(opts.DataDir)); statErr == nil {
				t.Fatal("an export appeared despite the mismatch")
			}
			if slices.Contains(*stages, StageDumping) {
				t.Fatalf("stages %v reached the dump", *stages)
			}
		})
	}
}

// TestRunNonZeroExit — a dumper that exits non-zero fails the run with its exit code and
// last output line; the previous export is left untouched and no temporary folder remains.
func TestRunNonZeroExit(t *testing.T) {
	_, opts, _ := setupFixture(t, "fail")
	prev := spartanpieces.DataEkurDir(opts.DataDir)
	writeExport(prev)
	marker := filepath.Join(prev, "materials", "previous.json")
	if err := os.WriteFile(marker, []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Run(context.Background(), opts)
	if !errors.Is(err, ErrDumpFailed) {
		t.Fatalf("err = %v, want ErrDumpFailed", err)
	}
	if msg := err.Error(); !strings.Contains(msg, "exited with code 3") || !strings.Contains(msg, "could not open module index") {
		t.Fatalf("message %q lacks the exit code or the dumper's last line", msg)
	}
	if _, err := os.Stat(marker); err != nil {
		t.Fatal("previous export touched by a failed run")
	}
	if left := leftovers(t, opts.DataDir); len(left) > 0 {
		t.Fatalf("temporary folders left: %v", left)
	}
}

// TestRunInvalidOutput — a dump that lacks contract entries fails validation, names what is
// missing, and never replaces <data>/ekur.
func TestRunInvalidOutput(t *testing.T) {
	_, opts, stages := setupFixture(t, "partial")
	_, err := Run(context.Background(), opts)
	if !errors.Is(err, ErrInvalidOutput) {
		t.Fatalf("err = %v, want ErrInvalidOutput", err)
	}
	if !strings.Contains(err.Error(), "globals.json") {
		t.Fatalf("message %q does not name the missing entries", err)
	}
	if _, statErr := os.Stat(spartanpieces.DataEkurDir(opts.DataDir)); statErr == nil {
		t.Fatal("an invalid dump was moved into place")
	}
	if left := leftovers(t, opts.DataDir); len(left) > 0 {
		t.Fatalf("temporary folders left: %v", left)
	}
	if (*stages)[len(*stages)-1] != StageValidating {
		t.Fatalf("stages = %v, want to end at validating", *stages)
	}
}

// TestRunDownloadFailed — a list the host does not serve fails the run as a download error
// and leaves no partial file.
func TestRunDownloadFailed(t *testing.T) {
	host, opts, _ := setupFixture(t, "ok")
	host.missing["/lists/"+MapIDsList] = true
	_, err := Run(context.Background(), opts)
	if !errors.Is(err, ErrDownload) || !strings.Contains(err.Error(), "HTTP 404") {
		t.Fatalf("err = %v, want ErrDownload with HTTP 404", err)
	}
	if _, statErr := os.Stat(filepath.Join(ToolsDir(opts.DataDir), MapIDsList+".part")); statErr == nil {
		t.Fatal("partial download left on disk")
	}
}

// TestRunOverride — with IT3D_EKUR_DIR set the run refuses before any download (the
// override would hide the app's own export from every build).
func TestRunOverride(t *testing.T) {
	host, opts, _ := setupFixture(t, "ok")
	t.Setenv(spartanpieces.EkurEnv, t.TempDir())
	if _, err := Run(context.Background(), opts); !errors.Is(err, ErrOverride) {
		t.Fatalf("err = %v, want ErrOverride", err)
	}
	if n := host.count("/ekur.exe"); n != 0 {
		t.Fatalf("dumper downloaded %d times under the override", n)
	}
}

// TestRunNoGame — no game folder, or one without its pc module folder, fails as ErrNoGame
// before any download.
func TestRunNoGame(t *testing.T) {
	host, opts, _ := setupFixture(t, "ok")
	opts.GameRoot = ""
	if _, err := Run(context.Background(), opts); !errors.Is(err, ErrNoGame) {
		t.Fatalf("no game: err = %v, want ErrNoGame", err)
	}
	opts.GameRoot = t.TempDir()
	if _, err := Run(context.Background(), opts); !errors.Is(err, ErrNoGame) {
		t.Fatalf("no pc folder: err = %v, want ErrNoGame", err)
	}
	if n := host.count("/ekur.exe"); n != 0 {
		t.Fatalf("dumper downloaded %d times without a game", n)
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

// TestPinnedRelease — the production pin is the Ekur 1.3.1 release asset.
func TestPinnedRelease(t *testing.T) {
	if PinnedExe.URL != "https://github.com/TheHaloArchive/ekur/releases/download/1.3.1/ekur-1.3.1.exe" ||
		PinnedExe.Name != "ekur-1.3.1.exe" || PinnedExe.Size != 1890304 ||
		PinnedExe.SHA256 != "cfc436523d3e9637d85c60d7e07f8f83ac293576a87c9c6dfa0927a838440c32" {
		t.Fatalf("pin = %+v", PinnedExe)
	}
	if ListsURL+StringsList != "https://github.com/TheHaloArchive/ReclaimerFiles/raw/refs/heads/master/strings.txt" {
		t.Fatalf("lists URL = %s", ListsURL)
	}
}
