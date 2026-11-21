// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

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
	if d := os.Getenv("FOOTSTEP_BUILD_DIR"); d != "" {
		dir = d // keep the takes for a listen or a level measurement
	}
	res, err := Build(ctx, Options{GameRoot: root, Module: module, OutDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Silent[SkippedTagMissing]) > 0 {
		t.Errorf("tags the module index has not: %v", res.Silent[SkippedTagMissing])
	}
	for reason, names := range res.Silent {
		if reason != SkippedTagMissing && reason != ShotNone && reason != ShotAmbiguous && reason != ShotLoopUnreadable && reason != SkippedMediaMissing && len(names) > 0 {
			t.Errorf("silent for %s: %v", reason, names)
		}
	}
	// The weapon shots: the Bandit's is three layers of five takes; every shot is found or named.
	if s := res.Manifest.Shots["hinf_bandit"]; len(s.Layers) != 3 || len(s.Takes) != 15 {
		t.Errorf("bandit shot: %d layers, %d takes", len(s.Layers), len(s.Takes))
	}
	// The Bandit's first-person shot: 30 stereo takes, a thump and a click, none with a falloff.
	if s := res.Manifest.ShotsFirstPerson["hinf_bandit"]; len(s.Layers) != 3 || len(s.Takes) != 32 {
		t.Errorf("bandit first-person shot: %d layers, %d takes", len(s.Layers), len(s.Takes))
	} else {
		for _, tk := range s.Takes {
			if tk.Falloff != "" {
				t.Errorf("bandit first-person take %s has falloff %s", tk.File, tk.Falloff)
			}
		}
	}
	if in := res.Manifest.Intro; in == nil || in.DurationMs != 16000 {
		t.Errorf("intro theme: %+v", in)
	}
	if s := res.Manifest.ShotsFirstPerson["hinf_bandit"]; len(s.Takes) > 0 && s.Takes[0].ReverbDB > -40 {
		t.Errorf("bandit first-person shot sends %.1f dB to the reverb, want about -60", s.Takes[0].ReverbDB)
	}
	for key, s := range res.Manifest.Shots {
		for _, tk := range s.Takes {
			if _, ok := res.Manifest.Falloffs[tk.Falloff]; !ok {
				t.Errorf("shot %s: take %s names falloff %q", key, tk.File, tk.Falloff)
			}
		}
		t.Logf("shot %s: %d layers, %d takes", key, len(s.Layers), len(s.Takes))
	}
	t.Logf("no shot: %v; ambiguous: %v", res.Silent[ShotNone], res.Silent[ShotAmbiguous])
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

	// Every take carries the game's authored volume (all below 0 dB on the foot steps) and names a
	// falloff the manifest has, silent at its end.
	check := func(name string, tk Take) {
		f, ok := res.Manifest.Falloffs[tk.Falloff]
		if !ok || len(f.Volume) < 2 {
			t.Errorf("%s: take %s names falloff %q", name, tk.File, tk.Falloff)
		} else if last := f.Volume[len(f.Volume)-1]; last[1] > -0.99 {
			t.Errorf("%s: falloff %s ends at %v, not silent", name, tk.Falloff, last)
		}
		if tk.GainDB >= 0 || tk.GainDB < -40 {
			t.Errorf("%s: take %s at %.1f dB", name, tk.File, tk.GainDB)
		}
	}
	for surface, actions := range res.Manifest.Feet {
		for action, f := range actions {
			for _, tk := range f.Takes {
				check(surface+"/"+action, tk)
			}
		}
	}
	for action, f := range res.Manifest.Movement {
		for _, tk := range f.Takes {
			check("movement/"+action, tk)
		}
	}
	t.Logf("%d falloffs", len(res.Manifest.Falloffs))
	if out := os.Getenv("FOOTSTEP_MANIFEST_OUT"); out != "" {
		raw, _ := os.ReadFile(filepath.Join(dir, ManifestName))
		_ = os.WriteFile(out, raw, 0o644)
	}

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
