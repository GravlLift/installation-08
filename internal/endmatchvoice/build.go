// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package endmatchvoice extracts the one end-of-match announcer line confirmed, by duration,
// against the installed game and the shipped file it replaces.
//
// A SURVEY, NOT A NAME CHAIN: unlike internal/eventsounds' bank/event ids, no comment anywhere
// in this codebase ever named the announcer vocalization behind round_over_en/fr or the
// end_{defeat,tie,victory,winner}_voice_*.ogg files. The only way in was the announcer's own
// catalog (internal/announcer, already built from the installed game by the server's existing
// job) and a wide survey of candidate vocalization names (plain, Wwise-string-id style
// concatenations: "defeat", "victory", "gametied", "roundwon", ...), matching what came out by
// DURATION against the shipped files (the lead's measurements, within 15ms). Of roughly sixty
// candidates tried, nine resolved to a real vocalization in this install's English catalog, and
// exactly one matched a shipped file's duration uniquely: the second take of "defeat" (1088ms)
// against end_defeat_voice_en_01.ogg (1094ms). Everything else either resolved to no shipped
// duration at all, or tied with another shipped file at the same length (the tie and victory
// calls both land near 1.25s) — ambiguous matches are left shipped rather than guessed. See the
// build-sounds report (and the CSV it was run from) for the full candidate table.
//
// FRENCH IS NOT REACHABLE AT ALL: this install's French announcer package does not exist
// (announcer.Discover on the French folder fails, same as the CLI's own --lang fallback), so no
// _fr_ shipped file can ever be built from it; this package only ever reads the English folder.
//
// THE SHIPPED COPY STAYS: an install without the English voice package (a tester's had only
// French) builds nothing here, so end_defeat_voice_en_01.ogg is kept in internal/sounds as the
// fallback; the built take wins wherever it exists.
package endmatchvoice

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
)

// ManifestName is the file the build writes to say which end-of-match lines the folder holds.
const ManifestName = "endmatchvoice.json"

// ManifestVersion is the manifest's format version; an older one is stale and the build runs again.
const ManifestVersion = 1

// Candidate is one shipped file this package tries to replace: the announcer vocalization name
// confirmed to exist in the installed catalog, and the duration (and tolerance) a matching take
// must land within — the only confirmation available, there being no documented id for it.
type Candidate struct {
	Stem         string
	Vocalization string
	TargetMs     int
	ToleranceMs  int
}

// Candidates are the end-of-match stems this package extracts, each confirmed by a unique
// duration match against the installed game's English announcer catalog.
var Candidates = []Candidate{
	{Stem: "end_defeat_voice_en_01", Vocalization: "defeat", TargetMs: 1094, ToleranceMs: 15},
}

// Take is an extracted line: its file, the vocalization it came from, and its length.
type Take struct {
	File         string `json:"file"`
	Vocalization string `json:"vocalization"`
	DurationMs   int    `json:"durationMs"`
}

// Manifest lists the extracted lines by stem.
type Manifest struct {
	Version int             `json:"version"`
	Sounds  map[string]Take `json:"sounds"`
}

// Options says where the game is and where the files go.
type Options struct {
	GameRoot string
	OutDir   string
}

// Result is what a build did: the manifest written, the files and bytes, and the stems whose
// vocalization or matching-duration take this install does not have.
type Result struct {
	Manifest *Manifest
	Files    int
	Bytes    int64
	Missing  []string
}

// englishFolder is the one language folder this package ever reads: the French announcer
// package does not exist in a typical install (confirmed on the one this package was built
// against), and a French take could not be told apart from an English one by duration alone, so
// a wrong-language guess is not a risk this package takes.
func englishFolder(gameRoot string) string {
	return filepath.Join(announcer.SoundRoot(gameRoot), "English(US)")
}

// Build extracts every Candidate whose vocalization exists in the installed game's English
// catalog and has a take within its duration tolerance, into opts.OutDir, and writes the
// manifest there. A candidate the install does not have, or whose takes all miss the duration
// window, is recorded in Result.Missing, never an error: the viewer falls back to the embedded
// file.
func Build(ctx context.Context, opts Options) (*Result, error) {
	if err := os.MkdirAll(opts.OutDir, 0o755); err != nil {
		return nil, err
	}
	res := &Result{Manifest: &Manifest{Version: ManifestVersion, Sounds: map[string]Take{}}}
	names := uniqueVocalizations()

	cat, err := announcer.Discover(ctx, opts.GameRoot, englishFolder(opts.GameRoot))
	if err != nil {
		// No English announcer package in this install at all: every candidate stays missing.
		for _, c := range Candidates {
			res.Missing = append(res.Missing, c.Stem)
		}
		if err := writeManifest(opts.OutDir, res.Manifest); err != nil {
			return nil, err
		}
		return res, nil
	}

	tmp, err := os.MkdirTemp(opts.OutDir, ".endmatchvoice-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	ext, err := announcer.Extract(ctx, cat, announcer.ExtractOptions{
		Names: names, OutDir: tmp, Language: "en", GameLanguage: "English(US)",
	})
	if err != nil {
		return nil, fmt.Errorf("endmatchvoice: %w", err)
	}

	for _, c := range Candidates {
		line, ok := ext.Manifest.Lines[c.Vocalization]
		if !ok {
			res.Missing = append(res.Missing, c.Stem)
			continue
		}
		take, ok := closestTake(line.Takes, c.TargetMs, c.ToleranceMs)
		if !ok {
			res.Missing = append(res.Missing, c.Stem)
			continue
		}
		raw, err := os.ReadFile(filepath.Join(tmp, take.File))
		if err != nil {
			return nil, err
		}
		file := c.Stem + ".ogg"
		if err := os.WriteFile(filepath.Join(opts.OutDir, file), raw, 0o644); err != nil {
			return nil, err
		}
		res.Manifest.Sounds[c.Stem] = Take{File: file, Vocalization: c.Vocalization, DurationMs: take.DurationMs}
		res.Files++
		res.Bytes += int64(len(raw))
	}
	if err := writeManifest(opts.OutDir, res.Manifest); err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "end-of-match voice extracted", "files", res.Files, "missing", res.Missing)
	return res, nil
}

// closestTake returns the take of a line whose duration lands within toleranceMs of targetMs,
// closest first; false when none do (an ambiguous tie among several equally-close takes is
// resolved by this order, but Candidates today has no case where two takes of the SAME line both
// land in the window — the ambiguity this package actually left shipped was between candidates
// of DIFFERENT vocalizations, caught upstream of this function by never adding them to
// Candidates).
func closestTake(takes []announcer.ManifestTake, targetMs, toleranceMs int) (announcer.ManifestTake, bool) {
	best := -1
	bestDiff := toleranceMs + 1
	for i, t := range takes {
		d := t.DurationMs - targetMs
		if d < 0 {
			d = -d
		}
		if d <= toleranceMs && d < bestDiff {
			bestDiff = d
			best = i
		}
	}
	if best < 0 {
		return announcer.ManifestTake{}, false
	}
	return takes[best], true
}

// uniqueVocalizations is every distinct vocalization name Candidates names, once each.
func uniqueVocalizations() []string {
	seen := map[string]bool{}
	var out []string
	for _, c := range Candidates {
		if !seen[c.Vocalization] {
			seen[c.Vocalization] = true
			out = append(out, c.Vocalization)
		}
	}
	return out
}

// ManifestStatus reads the manifest in dir: built when it is there and readable, stale when its
// version is older than ManifestVersion.
func ManifestStatus(dir string) (built, stale bool) {
	raw, err := os.ReadFile(filepath.Join(dir, ManifestName))
	if err != nil {
		return false, false
	}
	var m struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(raw, &m); err != nil {
		return false, false
	}
	return true, m.Version < ManifestVersion
}

func writeManifest(dir string, m *Manifest) error {
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, ManifestName), raw, 0o644)
}
