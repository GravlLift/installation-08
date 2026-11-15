// Package uisounds extracts the game's interface sounds the viewer plays outside the replay
// track, from the user's game install: today the countdown tick the pre-game screen plays on
// each of its 3, 2, 1.
//
// The sounds live in the interface's global bank (`sb_002_ui_global`, an `sbnk` tag of the
// platform globals modules), as embedded Wwise Vorbis media. Each one is addressed by its Wwise
// event name (the event id is the name's hash, internal/wwise.ID); the countdown event,
// `play_002_ui_menu_frontend_countdown_0`, was found by hashing names in the bank's own naming
// scheme (its siblings `play_002_ui_menu_frontend_select`, `_back` and `_load` are in the same
// 31-event bank). No final or "go" tone was found next to it. The build repacks each media as an
// Ogg file without decoding (internal/wwvorbis) and writes a manifest; nothing is committed to
// the repo: the files land in the data directory's sound folder, next to the announcer's.
package uisounds

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"sort"

	"github.com/JGtm/halo-infinite-files-reader/himodule"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/wwise"
	"github.com/llampwall/infinite-theater-3d/internal/wwvorbis"
)

// ManifestName is the file the build writes to say which interface sounds the folder holds.
const ManifestName = "ui.json"

// ManifestVersion is the manifest's format version; an older one is stale and the build runs again.
const ManifestVersion = 1

// BankName is the bank holding the interface sounds; its id is the hash of the name.
const BankName = "sb_002_ui_global"

// Sound is one interface sound the viewer plays: its file stem and the game event that posts it.
type Sound struct {
	Stem  string
	Event string
}

// Sounds are the interface sounds the build extracts.
var Sounds = []Sound{
	{Stem: "ui_countdown_tick", Event: "play_002_ui_menu_frontend_countdown_0"},
}

// Take is an extracted sound: its file, the event and media it came from, and its length.
type Take struct {
	File       string `json:"file"`
	Event      string `json:"event"`
	Media      uint32 `json:"media"`
	DurationMs int    `json:"durationMs"`
}

// Manifest lists the extracted sounds by stem.
type Manifest struct {
	Version int             `json:"version"`
	Sounds  map[string]Take `json:"sounds"`
}

// Options says where the game is (its deploy root) and where the files go.
type Options struct {
	DeployRoot string
	OutDir     string
}

// Result is what a build did: the manifest written, the files and bytes, and the stems it could
// not extract (no bank, no event, or a media that is not embedded Wwise Vorbis).
type Result struct {
	Manifest *Manifest
	Files    int
	Bytes    int64
	Missing  []string
}

// Build extracts the interface sounds into opts.OutDir and writes the manifest there. A sound the
// install does not carry is recorded in Result.Missing, never an error: the viewer stays silent
// on it.
func Build(ctx context.Context, opts Options) (*Result, error) {
	if err := os.MkdirAll(opts.OutDir, 0o755); err != nil {
		return nil, err
	}
	bank, err := findBank(filepath.Join(opts.DeployRoot, "pc", "globals"), wwise.ID(BankName))
	if err != nil {
		return nil, fmt.Errorf("uisounds: %w", err)
	}
	res := &Result{Manifest: &Manifest{Version: ManifestVersion, Sounds: map[string]Take{}}}
	for _, s := range Sounds {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		take, ok, err := extract(bank, s, opts.OutDir)
		if err != nil {
			return nil, fmt.Errorf("uisounds: %s: %w", s.Stem, err)
		}
		if !ok {
			res.Missing = append(res.Missing, s.Stem)
			continue
		}
		res.Manifest.Sounds[s.Stem] = take
		res.Files++
	}
	for _, t := range res.Manifest.Sounds {
		if info, err := os.Stat(filepath.Join(opts.OutDir, t.File)); err == nil {
			res.Bytes += info.Size()
		}
	}
	sort.Strings(res.Missing)
	if err := writeManifest(opts.OutDir, res.Manifest); err != nil {
		return nil, err
	}
	slog.InfoContext(ctx, "interface sounds extracted", "files", res.Files, "missing", res.Missing)
	return res, nil
}

// extract writes one sound's media as an Ogg file; false when the bank, the event or an
// embedded Vorbis media is missing.
func extract(bank *wwise.Bank, s Sound, outDir string) (Take, bool, error) {
	if bank == nil {
		return Take{}, false, nil
	}
	for _, media := range bank.EventMedia(wwise.ID(s.Event)) {
		raw, ok := bank.Embedded[media]
		if !ok {
			continue
		}
		if f, err := wwise.ParseMediaFormat(raw); err != nil || f.Codec != wwise.CodecVorbis {
			continue
		}
		ogg, err := wwvorbis.Repack(raw)
		if err != nil {
			return Take{}, false, fmt.Errorf("media %d: %w", media, err)
		}
		file := s.Stem + ".ogg"
		if err := os.WriteFile(filepath.Join(outDir, file), ogg.Ogg, 0o644); err != nil {
			return Take{}, false, err
		}
		return Take{File: file, Event: s.Event, Media: media, DurationMs: ogg.DurationMs()}, true, nil
	}
	return Take{}, false, nil
}

var errFound = errors.New("found")

// findBank returns the bank of the given id among the `sbnk` tags of a modules folder, or nil.
func findBank(dir string, id uint32) (*wwise.Bank, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.module"))
	if err != nil {
		return nil, err
	}
	var found *wwise.Bank
	for _, p := range paths {
		m, err := himodule.Open(p)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", p, err)
		}
		ferr := func() error {
			for _, f := range m.Files(announcer.GroupBank) {
				data, err := m.Extract(f)
				if err != nil {
					return err
				}
				at := wwise.IndexBKHD(data)
				if at < 0 {
					continue
				}
				bk, err := wwise.ParseBank(data[at:])
				if err != nil || bk.ID != id {
					continue
				}
				found = bk
				return errFound
			}
			return nil
		}()
		cerr := m.Close()
		if errors.Is(ferr, errFound) {
			return found, nil
		}
		if ferr != nil {
			return nil, ferr
		}
		if cerr != nil {
			return nil, cerr
		}
	}
	return nil, nil
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
