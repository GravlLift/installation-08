package announcer

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/wwise"
	"github.com/llampwall/infinite-theater-3d/internal/wwvorbis"
)

// ManifestName is the file the viewer reads to learn which announcer lines the sound folder holds.
const ManifestName = "announcer.json"

// ManifestVersion is the manifest's format version. Version 3: every take is the game's own
// Vorbis stream repacked into an Ogg file, without decoding (internal/wwvorbis). Version 2 takes
// were PCM WAV decoded by vgmstream, version 1 takes Ogg re-encoded by ffmpeg; a manifest of an
// older version is stale and the extraction runs again. Version 4 keeps the version 3 format and
// only widens the name set (the "strongholdlost" line). Version 5 keeps the version 4 format and
// widens the name set again: the stacker bank's CTF and Assault objective lines (the enemy
// capture, the flag taken, the bomb); an install's version 4 manifest goes stale and the
// extraction runs again with the wider set.
const ManifestVersion = 5

// TakeExt is the file extension of an extracted take.
const TakeExt = ".ogg"

// takeFile is the name of every take file any manifest version wrote: announcer_<line>_<nn>
// with the extension of its version (.ogg or .wav). A rebuild removes the ones its manifest no
// longer lists, and no other file.
var takeFile = regexp.MustCompile(`^announcer_[a-z0-9]+_[0-9]{2,}\.(ogg|wav)$`)

// Manifest lists the extracted lines by vocalization name.
type Manifest struct {
	Version int `json:"version"`
	// Language is the viewer's language code of the voice ("en", "fr").
	Language string `json:"language"`
	// GameLanguage is the game's language folder the packages were read from.
	GameLanguage string                  `json:"gameLanguage"`
	Lines        map[string]ManifestLine `json:"lines"`
}

// ManifestLine is one vocalization: the bank and event of its first take, and every take's file.
type ManifestLine struct {
	Bank  string         `json:"bank"`
	Event string         `json:"event"`
	Takes []ManifestTake `json:"takes"`
}

// ManifestTake is one extracted recording.
type ManifestTake struct {
	File       string `json:"file"`
	Media      uint32 `json:"media"`
	DurationMs int    `json:"durationMs"`
}

// ExtractOptions says what to extract and where.
type ExtractOptions struct {
	Names        []string
	OutDir       string
	Language     string
	GameLanguage string
}

// ExtractResult summarizes an extraction.
type ExtractResult struct {
	Manifest *Manifest
	Missing  []string
	Files    int
	Bytes    int64
	// Removed is the number of take files of an earlier extraction the new manifest no longer
	// lists, deleted from OutDir.
	Removed int
}

// ManifestStatus reads the manifest in dir: built when it is there and readable, stale when its
// version is older than ManifestVersion (its takes are in a format this build no longer writes).
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

// mediaSource returns the bytes of a media id: streamed from a language package, or embedded in
// its bank.
type mediaSource func(id uint32) ([]byte, error)

// Extract writes the named lines of the catalog into OutDir as Ogg Vorbis takes, writes the
// manifest there, then removes the take files of an earlier extraction the manifest does not
// list. A name the catalog does not hold is reported in Missing, never an error: the viewer stays
// silent on it.
func Extract(ctx context.Context, c *Catalog, opts ExtractOptions) (*ExtractResult, error) {
	if err := os.MkdirAll(opts.OutDir, 0o755); err != nil {
		return nil, err
	}
	src := c.mediaSource()
	res := &ExtractResult{Manifest: &Manifest{Version: ManifestVersion, Language: opts.Language, GameLanguage: opts.GameLanguage, Lines: map[string]ManifestLine{}}}
	for _, name := range uniqueSorted(opts.Names) {
		if !ValidName(name) {
			return nil, fmt.Errorf("announcer: %q is not a vocalization name", name)
		}
		line, ok := c.Lookup(name)
		if !ok {
			res.Missing = append(res.Missing, name)
			continue
		}
		ml, err := extractLine(name, line, src, opts.OutDir, res)
		if err != nil {
			return nil, fmt.Errorf("announcer: %s: %w", name, err)
		}
		res.Manifest.Lines[name] = ml
	}
	raw, err := json.MarshalIndent(res.Manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(opts.OutDir, ManifestName), raw, 0o644); err != nil {
		return nil, err
	}
	if res.Removed, err = removeStaleTakes(opts.OutDir, res.Manifest); err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "announcer extracted", "lines", len(res.Manifest.Lines), "files", res.Files, "missing", len(res.Missing), "removed", res.Removed)
	return res, nil
}

// extractLine writes every take of one line. A take's event can play several media (a random
// container): each media is one take.
func extractLine(name string, line Line, src mediaSource, outDir string, res *ExtractResult) (ManifestLine, error) {
	ml := ManifestLine{Bank: line.Takes[0].Bank, Event: fmt.Sprintf("%08x", line.Takes[0].Event)}
	seen := map[uint32]bool{}
	for _, take := range line.Takes {
		for _, media := range take.MediaIDs {
			if seen[media] {
				continue
			}
			seen[media] = true
			file := fmt.Sprintf("announcer_%s_%02d%s", name, len(ml.Takes)+1, TakeExt)
			ms, size, err := repackMedia(src, media, filepath.Join(outDir, file))
			if err != nil {
				return ManifestLine{}, err
			}
			ml.Takes = append(ml.Takes, ManifestTake{File: file, Media: media, DurationMs: ms})
			res.Files++
			res.Bytes += size
		}
	}
	return ml, nil
}

// repackMedia writes one media to out as Ogg Vorbis and returns its duration (from the stream's
// own sample count) and the file's size.
func repackMedia(src mediaSource, media uint32, out string) (int, int64, error) {
	raw, err := src(media)
	if err != nil {
		return 0, 0, err
	}
	s, err := wwvorbis.Repack(raw)
	if err != nil {
		return 0, 0, fmt.Errorf("media %d: %w", media, err)
	}
	if err := os.WriteFile(out, s.Ogg, 0o644); err != nil {
		return 0, 0, err
	}
	return s.DurationMs(), int64(len(s.Ogg)), nil
}

// removeStaleTakes deletes the regular files of dir named like a take (takeFile) that m does not
// list, and returns how many it deleted. Nothing else in dir is touched, and nothing below it.
func removeStaleTakes(dir string, m *Manifest) (int, error) {
	keep := map[string]bool{}
	for _, l := range m.Lines {
		for _, t := range l.Takes {
			keep[t.File] = true
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0, err
	}
	removed := 0
	for _, e := range entries {
		if !e.Type().IsRegular() || !takeFile.MatchString(e.Name()) || keep[e.Name()] {
			continue
		}
		if err := os.Remove(filepath.Join(dir, e.Name())); err != nil {
			return removed, fmt.Errorf("announcer: remove stale take: %w", err)
		}
		removed++
	}
	return removed, nil
}

// mediaSource indexes the catalog's media: the language packages first, then the media embedded
// in the banks.
func (c *Catalog) mediaSource() mediaSource {
	type ref struct {
		pack  *wwise.Package
		entry wwise.PackageEntry
	}
	streamed := map[uint64]ref{}
	for _, p := range c.Packs {
		for _, e := range p.Entries {
			if _, dup := streamed[e.ID]; !dup {
				streamed[e.ID] = ref{p, e}
			}
		}
	}
	return func(id uint32) ([]byte, error) {
		if r, ok := streamed[uint64(id)]; ok {
			return r.pack.ReadEntry(r.entry)
		}
		if b, ok := c.embedded[id]; ok {
			return b, nil
		}
		return nil, fmt.Errorf("media %d is in no package and no bank", id)
	}
}

// uniqueSorted returns the names once each, in order.
func uniqueSorted(names []string) []string {
	set := map[string]bool{}
	for _, n := range names {
		if n = strings.TrimSpace(n); n != "" {
			set[n] = true
		}
	}
	out := make([]string, 0, len(set))
	for n := range set {
		out = append(out, n)
	}
	sort.Strings(out)
	return out
}
