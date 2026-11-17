// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package uisounds extracts the game's interface sounds the viewer plays outside the replay
// track, from the user's game install: the countdown tick the pre-game screen plays on each of
// its 3, 2, 1, and the followed Spartan's own shield alarms (low, break, depleted, recharge).
//
// The sounds live in `sbnk` tags of the platform globals modules, as embedded Wwise Vorbis
// media. Each one is addressed by its Wwise event name (the event id is the name's hash,
// internal/wwise.ID). The countdown event, `play_002_ui_menu_frontend_countdown_0` of the
// interface's global bank `sb_002_ui_global`, was found by hashing names in the bank's own naming
// scheme (its siblings `play_002_ui_menu_frontend_select`, `_back` and `_load` are in the same
// 31-event bank). No final or "go" tone was found next to it.
//
// The shield events are in the Spartan character bank `sb_006_cfx_un_spartan` (39 events), found
// the same way; their names and structure, read from the bank's hierarchy (v135):
//   - `play_..._shield_low`: one Sound looping forever (loop property 0), 4 beeps in 0.82 s;
//     `stop_..._shield_low` stops it.
//   - `play_..._shield_depleted`: a container of one Sound looping forever, 12 faster beeps in
//     2.3 s; `stop_..._shield_depleted` stops it.
//   - `play_..._shield_break`: a 3.3 s stereo break (plus a Wwise Silence source, not media).
//   - `play_..._shield_recharge_2d`: three layers, a 0.13 s attack, a 0.64 s layer, and a switch
//     container (group `hud_shield_recharge`, set by game code) whose ten states each play one
//     rise of 0.45 to 2.3 s; a second state of the outer switch plays a 7 s sound, left out.
//     `stop_..._shield_recharge_2d` stops the rise and plays a 1.05 s "full" tone plus a 0.3 s
//     layer. Which switch state the game sets is not readable from the files, so every rise is
//     extracted and the viewer picks one (web: shieldSound.ts).
//
// Their neighbors in the bank are `health_recharge`, `health_low_warning` and `player_respawn`.
// The build repacks each media as an Ogg file without decoding (internal/wwvorbis) and writes a
// manifest; nothing is committed to the repo: the files land in the data directory's sound
// folder, next to the announcer's.
package uisounds

import (
	"context"
	"encoding/binary"
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
// Version 2 added the shield sounds.
const ManifestVersion = 2

// BankName is the bank holding the interface sounds; its id is the hash of the name.
const BankName = "sb_002_ui_global"

// SpartanBank is the Spartan character bank holding the shield sounds.
const SpartanBank = "sb_006_cfx_un_spartan"

// Sound is one interface sound the viewer plays: its file stem, the game event that posts it,
// the bank holding the event (BankName when empty), and the media to take among the event's
// (0: the first embedded Vorbis media; set where an event plays several layers).
type Sound struct {
	Stem  string
	Event string
	Bank  string
	Media uint32
}

const (
	shieldRecharge     = "play_006_cfx_un_spartan_shield_recharge_2d"
	shieldRechargeStop = "stop_006_cfx_un_spartan_shield_recharge_2d"
)

// Sounds are the interface sounds the build extracts.
var Sounds = []Sound{
	{Stem: "ui_countdown_tick", Event: "play_002_ui_menu_frontend_countdown_0"},
	{Stem: "shield_low_loop", Bank: SpartanBank, Event: "play_006_cfx_un_spartan_shield_low"},
	{Stem: "shield_depleted_loop", Bank: SpartanBank, Event: "play_006_cfx_un_spartan_shield_depleted"},
	{Stem: "shield_break", Bank: SpartanBank, Event: "play_006_cfx_un_spartan_shield_break"},
	{Stem: "shield_recharge_start", Bank: SpartanBank, Event: shieldRecharge, Media: 447455419},
	{Stem: "shield_recharge_layer", Bank: SpartanBank, Event: shieldRecharge, Media: 252351767},
	// The ten rises of the `hud_shield_recharge` switch, in the bank's child order. The state
	// names end in 00, 5, 10, 20, 30, 40, 60, 70 and two unread ones (recovered from their hashes).
	{Stem: "shield_recharge_rise_0", Bank: SpartanBank, Event: shieldRecharge, Media: 767047640},
	{Stem: "shield_recharge_rise_1", Bank: SpartanBank, Event: shieldRecharge, Media: 1046126693},
	{Stem: "shield_recharge_rise_2", Bank: SpartanBank, Event: shieldRecharge, Media: 400969240},
	{Stem: "shield_recharge_rise_3", Bank: SpartanBank, Event: shieldRecharge, Media: 1003689669},
	{Stem: "shield_recharge_rise_4", Bank: SpartanBank, Event: shieldRecharge, Media: 398122527},
	{Stem: "shield_recharge_rise_5", Bank: SpartanBank, Event: shieldRecharge, Media: 269957561},
	{Stem: "shield_recharge_rise_6", Bank: SpartanBank, Event: shieldRecharge, Media: 964776530},
	{Stem: "shield_recharge_rise_7", Bank: SpartanBank, Event: shieldRecharge, Media: 389631724},
	{Stem: "shield_recharge_rise_8", Bank: SpartanBank, Event: shieldRecharge, Media: 6517444},
	{Stem: "shield_recharge_rise_9", Bank: SpartanBank, Event: shieldRecharge, Media: 95227746},
	{Stem: "shield_full", Bank: SpartanBank, Event: shieldRechargeStop, Media: 1010067797},
	{Stem: "shield_full_layer", Bank: SpartanBank, Event: shieldRechargeStop, Media: 460671639},
}

// bankOf is the bank a sound's event is in.
func (s Sound) bankOf() string {
	if s.Bank == "" {
		return BankName
	}
	return s.Bank
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
	wanted := map[uint32]bool{}
	for _, s := range Sounds {
		wanted[wwise.ID(s.bankOf())] = true
	}
	banks, err := findBanks(filepath.Join(opts.DeployRoot, "pc", "globals"), wanted)
	if err != nil {
		return nil, fmt.Errorf("uisounds: %w", err)
	}
	res := &Result{Manifest: &Manifest{Version: ManifestVersion, Sounds: map[string]Take{}}}
	for _, s := range Sounds {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		take, ok, err := extract(banks[wwise.ID(s.bankOf())], s, opts.OutDir)
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
// embedded Vorbis media (the one asked, when s.Media is set) is missing.
func extract(bank *wwise.Bank, s Sound, outDir string) (Take, bool, error) {
	if bank == nil {
		return Take{}, false, nil
	}
	for _, media := range bank.EventMedia(wwise.ID(s.Event)) {
		if s.Media != 0 && media != s.Media {
			continue
		}
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

// findBanks returns the banks of the wanted ids found among the `sbnk` tags of a modules folder,
// in one pass that stops once all are found; an id absent from the folder has no entry.
func findBanks(dir string, wanted map[uint32]bool) (map[uint32]*wwise.Bank, error) {
	paths, err := filepath.Glob(filepath.Join(dir, "*.module"))
	if err != nil {
		return nil, err
	}
	found := map[uint32]*wwise.Bank{}
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
				// The bank id is the BKHD's second word: read it before parsing the whole bank.
				if len(data) < at+16 || !wanted[binary.LittleEndian.Uint32(data[at+12:])] {
					continue
				}
				bk, err := wwise.ParseBank(data[at:])
				if err != nil || !wanted[bk.ID] || found[bk.ID] != nil {
					continue
				}
				found[bk.ID] = bk
				if len(found) == len(wanted) {
					return errFound
				}
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
	return found, nil
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
