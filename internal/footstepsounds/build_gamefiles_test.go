//go:build gamefiles

package footstepsounds

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/llampwall/infinite-theater-3d/internal/firstperson"
)

// TestBuildFromTheInstalledGame extracts the foot and movement sounds of the installed game:
// every table entry the game has gets takes, every take the manifest lists is an Ogg file, and
// nothing in the table is left missing or silent.
func TestBuildFromTheInstalledGame(t *testing.T) {
	ctx := context.Background()
	root, module, err := firstperson.ResolveModule(ctx, firstperson.Options{})
	if err != nil {
		t.Skipf("no installed game: %v", err)
	}
	dir := t.TempDir()
	res, err := Build(ctx, Options{GameRoot: root, Module: module, OutDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Silent[SkippedTagMissing]) > 0 {
		t.Errorf("tags the module index has not: %v", res.Silent[SkippedTagMissing])
	}
	for reason, names := range res.Silent {
		if reason != SkippedTagMissing && len(names) > 0 {
			t.Errorf("silent for %s: %v", reason, names)
		}
	}
	for surface, actions := range res.Manifest.Feet {
		for action, f := range actions {
			if len(f.Takes) == 0 {
				t.Errorf("%s/%s: no takes", surface, action)
			}
		}
	}
	for action, f := range res.Manifest.Movement {
		if len(f.Takes) == 0 {
			t.Errorf("movement/%s: no takes", action)
		}
	}
	// summary for the RESULT: files, bytes, and per entry the take count and duration range.
	surfaces := make([]string, 0, len(res.Manifest.Feet))
	for surface := range res.Manifest.Feet {
		surfaces = append(surfaces, surface)
	}
	sort.Strings(surfaces)
	var lines []string
	for _, surface := range surfaces {
		actions := res.Manifest.Feet[surface]
		names := make([]string, 0, len(actions))
		for action := range actions {
			names = append(names, action)
		}
		sort.Strings(names)
		var parts []string
		for _, action := range names {
			f := actions[action]
			min, max := 1<<30, 0
			for _, tk := range f.Takes {
				if tk.DurationMs < min {
					min = tk.DurationMs
				}
				if tk.DurationMs > max {
					max = tk.DurationMs
				}
			}
			if max == 0 {
				min = 0
			}
			parts = append(parts, fmt.Sprintf("%s:%d[%d-%d]", action, len(f.Takes), min, max))
		}
		lines = append(lines, surface+" "+strings.Join(parts, " "))
	}
	for action, f := range res.Manifest.Movement {
		min, max := 1<<30, 0
		for _, tk := range f.Takes {
			if tk.DurationMs < min {
				min = tk.DurationMs
			}
			if tk.DurationMs > max {
				max = tk.DurationMs
			}
		}
		if max == 0 {
			min = 0
		}
		lines = append(lines, fmt.Sprintf("movement %s:%d[%d-%d]", action, len(f.Takes), min, max))
	}
	t.Logf("extracted %d files, %d bytes\n%s", res.Files, res.Bytes, strings.Join(lines, "\n"))

	for surface, actions := range res.Manifest.Feet {
		for action, f := range actions {
			for _, tk := range f.Takes {
				raw, err := os.ReadFile(filepath.Join(dir, tk.File))
				if err != nil || !bytes.HasPrefix(raw, []byte("OggS")) || tk.DurationMs <= 0 {
					t.Errorf("%s/%s: take %s (%d ms): %v", surface, action, tk.File, tk.DurationMs, err)
				}
			}
		}
	}
}
