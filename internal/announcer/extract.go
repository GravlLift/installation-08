package announcer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"

	"github.com/llampwall/infinite-theater-3d/internal/wwise"
)

// ManifestName is the file the viewer reads to learn which announcer lines the sound folder holds.
const ManifestName = "announcer.json"

// ManifestVersion is the manifest's format version.
const ManifestVersion = 1

// Tools are the two programs extraction runs. The game stores its voice as Wwise Vorbis, which
// only a Wwise-aware decoder reads: Decoder is a `vgmstream-cli` executable (it writes PCM WAV),
// and Encoder an `ffmpeg` executable with libvorbis (it writes the Ogg Vorbis the sound route
// serves).
type Tools struct {
	Decoder string
	Encoder string
}

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

// ManifestTake is one decoded recording.
type ManifestTake struct {
	File       string `json:"file"`
	Media      uint32 `json:"media"`
	DurationMs int    `json:"durationMs"`
}

// ExtractOptions says what to extract and where.
type ExtractOptions struct {
	Names        []string
	Tools        Tools
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
}

// mediaSource returns the bytes of a media id: streamed from a language package, or embedded in
// its bank.
type mediaSource func(id uint32) ([]byte, error)

// Extract decodes the named lines of the catalog into OutDir and writes the manifest there. A name
// the catalog does not hold is reported in Missing, never an error: the viewer stays silent on it.
func Extract(ctx context.Context, c *Catalog, opts ExtractOptions) (*ExtractResult, error) {
	if opts.Tools.Decoder == "" || opts.Tools.Encoder == "" {
		return nil, errors.New("announcer: a decoder (vgmstream-cli) and an encoder (ffmpeg) are required")
	}
	if err := os.MkdirAll(opts.OutDir, 0o755); err != nil {
		return nil, err
	}
	work, err := os.MkdirTemp("", "announcer-extract-")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(work)
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
		ml, err := extractLine(ctx, name, line, src, opts, work, res)
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
	slog.InfoContext(ctx, "announcer extracted", "lines", len(res.Manifest.Lines), "files", res.Files, "missing", len(res.Missing))
	return res, nil
}

// extractLine decodes every take of one line. A take's event can play several media (a random
// container): each media is one take.
func extractLine(ctx context.Context, name string, line Line, src mediaSource, opts ExtractOptions, work string, res *ExtractResult) (ManifestLine, error) {
	ml := ManifestLine{Bank: line.Takes[0].Bank, Event: fmt.Sprintf("%08x", line.Takes[0].Event)}
	seen := map[uint32]bool{}
	for _, take := range line.Takes {
		for _, media := range take.MediaIDs {
			if seen[media] {
				continue
			}
			seen[media] = true
			file := fmt.Sprintf("announcer_%s_%02d.ogg", name, len(ml.Takes)+1)
			ms, size, err := decodeMedia(ctx, src, media, opts.Tools, work, filepath.Join(opts.OutDir, file))
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

// decodeMedia writes one media as Ogg Vorbis at out and returns its duration (read from the
// decoded PCM) and the written file's size.
func decodeMedia(ctx context.Context, src mediaSource, media uint32, tools Tools, work, out string) (int, int64, error) {
	raw, err := src(media)
	if err != nil {
		return 0, 0, err
	}
	wem := filepath.Join(work, fmt.Sprintf("%d.wem", media))
	wav := filepath.Join(work, fmt.Sprintf("%d.wav", media))
	if err := os.WriteFile(wem, raw, 0o644); err != nil {
		return 0, 0, err
	}
	if err := run(ctx, tools.Decoder, "-o", wav, wem); err != nil {
		return 0, 0, fmt.Errorf("decode media %d: %w", media, err)
	}
	pcm, err := os.ReadFile(wav)
	if err != nil {
		return 0, 0, err
	}
	ms, err := WAVDurationMs(pcm)
	if err != nil {
		return 0, 0, fmt.Errorf("media %d: %w", media, err)
	}
	if err := run(ctx, tools.Encoder, "-y", "-loglevel", "error", "-i", wav, "-c:a", "libvorbis", "-q:a", "5", out); err != nil {
		return 0, 0, fmt.Errorf("encode media %d: %w", media, err)
	}
	st, err := os.Stat(out)
	if err != nil {
		return 0, 0, err
	}
	return ms, st.Size(), nil
}

// run runs a tool and returns its output in the error when it fails.
func run(ctx context.Context, tool string, args ...string) error {
	out, err := exec.CommandContext(ctx, tool, args...).CombinedOutput()
	if err != nil {
		return fmt.Errorf("%s: %w: %s", filepath.Base(tool), err, strings.TrimSpace(string(out)))
	}
	return nil
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
