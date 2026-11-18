// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package eventsounds extracts a mixed set of one-shot replay sound effects from the user's
// installed game: the repair field's activation and end, the weapon stand-and-drop sounds, the
// objective family's skull (Oddball), zone capture and bomb detonation calls, and the equipment
// family's single-take sounds (camo end, shroud deploy, grapple, repulsor, pickup). It replaces the
// matching files of internal/sounds/files/halo_infinite (hand-produced, embedded in the binary)
// the same way internal/uisounds replaces the interface sounds: the viewer keeps requesting the
// same stems, served from the data directory's sound folder when built and from the embedded set
// otherwise (cmd/infinite-theater-3d/serve_sounds.go).
//
// EACH SOUND IS REACHED ONE OF TWO WAYS, both ending at a Wwise `sbnk` bank parsed by
// internal/wwise:
//
//   - Tag: the bank is an EKUR tag of the platform globals modules, extracted directly
//     (github.com/JGtm/halo-infinite-map-images/himap.ModuleIndex.Extract). This is the id a
//     sound tag's own dependency table names (same numbering internal/soundtags reads at its
//     offsets 0x2c/0x48) — not a Wwise name hash. Measured on the installed game: the repair
//     field's `eqip` (5c8e2316) names its bank by this id (5724312f), and extracting that id
//     directly yields the bank holding its event (c48cf171) and no other reachable path confirms
//     the id faster.
//   - Name: the bank is found by a brute scan of the platform globals modules for an `sbnk`
//     whose own id (the Wwise hash of its name) matches (the uisounds.go mechanism, same scan,
//     same early exit once every wanted bank is found). Used where the comment that named the
//     sound gave a bank NAME, not a tag id (the ability banks, the weapon-pad bank, the Spartan
//     character bank, the Assault bank).
//
// Every event id below was confirmed against the installed game: its media exist, are Wwise
// Vorbis, and (where the game's own Wwise event name or a documented duration survived in the
// code this package replaces) the repacked duration matches within a few milliseconds. A handful
// of candidate sounds surveyed for this package resolved to an event whose media duration was
// NOT close to the shipped file's (the ability events for the translocator and the thruster, and
// two "zone" gestures whose bank this package otherwise reaches cleanly) — those are left shipped
// deliberately; see the package's build-sounds report for the measured durations, and NOTICE.md
// for the running count of what remains embedded.
package eventsounds

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
	"github.com/JGtm/halo-infinite-map-images/himap"

	"github.com/llampwall/infinite-theater-3d/internal/announcer"
	"github.com/llampwall/infinite-theater-3d/internal/wwise"
	"github.com/llampwall/infinite-theater-3d/internal/wwvorbis"
)

// ManifestName is the file the build writes to say which event sounds the folder holds.
const ManifestName = "events.json"

// ManifestVersion is the manifest's format version; an older one is stale and the build runs again.
//
// 2: the equipment family (camo end, shroud deploy, grapple, repulsor, equipment pickup).
const ManifestVersion = 2

// Sound is one event sound the viewer plays: its file stem, where its bank is (Tag xor Name),
// the event that posts it, and how many of the event's media to write as numbered variants.
type Sound struct {
	Stem string
	// Tag is the bank's EKUR tag id (extracted directly); Name is the bank's Wwise name (found by
	// scanning); exactly one of the two is set.
	Tag  uint32
	Name string
	// Event is the Wwise event id posted for this sound.
	Event uint32
	// Media, when nonzero, is the one media id to take among the event's (disambiguates an event
	// whose media are not interchangeable variants — a specific detonation layer, a specific
	// scoring tick).
	Media uint32
	// Variants is how many of the event's media to write, numbered stem, stem_v2, ... stem_vN (as
	// SOUND_VARIANTS lists them in web/src/features/match-replay/sound/replaySoundVariants.ts);
	// 0 or 1 writes a single file from the first matching media.
	Variants int
}

// Sounds are the event sounds this package extracts, confirmed against the installed game
// (durations and, where documented, exact media ids match the game's own events).
var Sounds = []Sound{
	// The repair field (eqip 5c8e2316, bank tag 5724312f): three interchangeable takes of the
	// activation, `play_007_abl_repairfield_activate` (event c48cf171, measured 3.26s — matches
	// the game's own naming survey exactly), and of the end/collapse,
	// `play_007_abl_repairfield_deactivate` (event 6aa63330, named by the same bank's naming
	// convention; the comment this package replaces never resolved this event, only the
	// activation).
	{Stem: "repair_field_activate", Tag: 0x5724312f, Event: 0xc48cf171, Variants: 3},
	{Stem: "repair_field_end", Tag: 0x5724312f, Event: 0x6aa63330, Variants: 3},

	// The Spartan's weapon stand-and-drop sounds (bank tag e9a52b26, `sb_006_chm_un_spartan`):
	// `play_006_chm_un_spartan_weapondrop` (event 6cdd92fd, measured ~0.31-0.40s across its three
	// takes, matching the shipped file's 0.32s) and the pickup (event 168832f6, ~0.29-0.34s,
	// matching the shipped file's 0.35s). Single takes: the shipped files are not the
	// variant-rotated kind (replaySoundVariants.ts has no entry for either stem).
	{Stem: "weapon_drop", Tag: 0xe9a52b26, Event: 0x6cdd92fd, Media: 191616773},
	{Stem: "weapon_pickup", Tag: 0xe9a52b26, Event: 0x168832f6, Media: 374880749},

	// The weapon and equipment stand appearance sounds, found by name (no sound tag chain was
	// documented for either): `play_004_mod_mp_shared_weaponpad_appear` (event 54bd9e43, bank
	// `sb_004_mod_mp_shared_weaponpad`, measured 1.41s, matching the shipped 1.42s) and the
	// equipment stand's event 4093f3c4 (bank `sb_007_abl_shared`, 0.56s, matching the shipped
	// 0.57s).
	{Stem: "objective_pad_spawn", Name: "sb_004_mod_mp_shared_weaponpad", Event: 0x54bd9e43},
	{Stem: "equipment_pad_spawn", Name: "sb_007_abl_shared", Event: 0x4093f3c4},

	// Assault's bomb detonation (bank `sb_004_mod_mp_assault`, found by name): event 984f65e5
	// plays two media, the documented one (538469998, 4.41s, matching the shipped 4.41s) and a
	// second, much longer one (8.0s) that is some other layer of the same event — Media picks the
	// documented take.
	{Stem: "objective_bomb_detonated", Name: "sb_004_mod_mp_assault", Event: 0x984f65e5, Media: 538469998},

	// Oddball's skull gestures (bank tag b0c651ea, `sb_004_mod_mp_oddball`): every one measured
	// within a few milliseconds of its matching shipped file. Variant counts match
	// replaySoundVariants.ts exactly (spawn has none, despawn/taken/pickup have two, dropped three
	// — the game's own RandomSequence sizes).
	{Stem: "objective_skull_spawn", Tag: 0xb0c651ea, Event: 0xf1dbd79a},
	{Stem: "objective_skull_despawn", Tag: 0xb0c651ea, Event: 0xfab3a00d, Variants: 2},
	{Stem: "objective_skull_taken", Tag: 0xb0c651ea, Event: 0xdb39b4c6, Variants: 2},
	{Stem: "objective_skull_pickup", Tag: 0xb0c651ea, Event: 0xf8b484a1, Variants: 2},
	{Stem: "objective_skull_dropped", Tag: 0xb0c651ea, Event: 0x4a27941d, Variants: 3},

	// The objective "modes shared" bank (bank tag 1c609526, 584 objects — Strongholds and CTF
	// calls together). Three of its zone calls measured within a few milliseconds of their
	// matching shipped file: the ally capture (event d8a2fcb8, two media — the layer at 90826356
	// matches, 2.89s; the other, 1.95s, is a different layer of the same gesture, left out), the
	// enemy capture (three equivalent event ids in the game's own data, 4ebe99d6 chosen as the
	// first and sufficient: all three play the identical single media, 2.30s), and "contested"
	// (event c3327c0b, 1.18s). The CTF flag calls (no event id ever recovered in this package's
	// predecessor, only a bank and a naming pattern that does not resolve against this bank) and
	// two more zone calls that DO resolve here (the scoring tick and the zone-securing gestures)
	// but whose media run far shorter than the shipped files (roughly half and a third,
	// respectively — a different gesture than the one shipped) are deliberately left out: see the
	// package doc and the build-sounds report.
	{Stem: "objective_zone_captured_team", Tag: 0x1c609526, Event: 0xd8a2fcb8, Media: 90826356},
	{Stem: "objective_zone_captured_enemy", Tag: 0x1c609526, Event: 0x4ebe99d6},
	{Stem: "objective_zone_contested", Tag: 0x1c609526, Event: 0xc3327c0b},

	// The equipment family, found by name: each bank's own id is the Wwise hash of the name below
	// (confirmed against the installed game, globals-rtx-new.module), and each event's name is
	// LevelUp's own survey of the `sb_007_abl_*` banks (`.ai/V7.5/RE_BANQUES_SONORES_NOMMEES`
	// section 3.4). Every take was measured within 5 ms of the shipped file it replaces; where an
	// event plays several takes, Media pins the one each shipped stem was cut from, so a shipped
	// variant's stem keeps its own take.
	//   - active camo's end, `play_007_abl_activecamo_deactivate_player` (afde714f, one take,
	//     1908 ms vs the shipped 1903 ms). Its activation (aa932bc4, 1924 ms) is NOT the shipped
	//     3415 ms file, nor are the overshield's start/end (09eec642 1867 ms vs 3995 ms, 40d46c8f
	//     1700 ms vs 2155 ms): those shipped files are assembled from more than one layer and stay.
	//   - the shroud screen's deploy, `play_007_abl_shroud_deploy_player` (ecd34df7, three takes;
	//     343194978 is the shipped one, 1835 ms vs 1834 ms).
	//   - the grappling hook's fire, `play_007_abl_grapplinghook_deploy_player` (34df0941): its
	//     three takes are the shipped three, 745/765/757 ms vs 745/764/757 ms.
	//   - the repulsor's pulse, `play_007_abl_knockback_pulse_player` (5fa136df): its three takes
	//     are the shipped repulsor_kill three, 1537/1447/1595 ms vs 1536/1446/1594 ms.
	//   - the equipment pickup, `play_007_abl_shared_pickup` (c73036e4, two takes; 779938423 is
	//     the shipped objective_pad_pickup, 804 ms vs 804 ms).
	{Stem: "camo_deactivate", Name: "sb_007_abl_activecamo", Event: 0xafde714f},
	{Stem: "shroud_deploy", Name: "sb_007_abl_shroud", Event: 0xecd34df7, Media: 343194978},
	{Stem: "grapple_fire", Name: "sb_007_abl_grapplinghook", Event: 0x34df0941, Media: 646478996},
	{Stem: "grapple_fire_v2", Name: "sb_007_abl_grapplinghook", Event: 0x34df0941, Media: 880401016},
	{Stem: "grapple_fire_v3", Name: "sb_007_abl_grapplinghook", Event: 0x34df0941, Media: 970648875},
	{Stem: "repulsor_kill", Name: "sb_007_abl_knockback", Event: 0x5fa136df, Media: 429477947},
	{Stem: "repulsor_kill_v2", Name: "sb_007_abl_knockback", Event: 0x5fa136df, Media: 625402148},
	{Stem: "repulsor_kill_v3", Name: "sb_007_abl_knockback", Event: 0x5fa136df, Media: 856604309},
	{Stem: "objective_pad_pickup", Name: "sb_007_abl_shared", Event: 0xc73036e4, Media: 779938423},
}

// bankDirs are the platform globals modules this package scans for bank tags and, by name,
// `sbnk` tags: the same folders uisounds.go and the announcer's banks read.
func bankDirs(gameRoot string) []string {
	return []string{filepath.Join(gameRoot, "pc", "globals"), filepath.Join(gameRoot, "any", "globals")}
}

// Take is an extracted sound: its file, the event and media it came from, and its length.
type Take struct {
	File       string `json:"file"`
	Event      uint32 `json:"event"`
	Media      uint32 `json:"media"`
	DurationMs int    `json:"durationMs"`
}

// Manifest lists the extracted sounds by stem; a variant-rotated sound's extra takes are keyed
// by their own stem (stem_v2, ...), exactly as the viewer requests them.
type Manifest struct {
	Version int             `json:"version"`
	Sounds  map[string]Take `json:"sounds"`
}

// Options says where the game is and where the files go.
type Options struct {
	GameRoot string
	OutDir   string
}

// Result is what a build did: the manifest written, the files and bytes, and the stems it could
// not extract (bank or event not found in this install).
type Result struct {
	Manifest *Manifest
	Files    int
	Bytes    int64
	Missing  []string
}

// Build extracts the event sounds into opts.OutDir and writes the manifest there. A sound whose
// bank or event the install does not carry is recorded in Result.Missing, never an error: the
// viewer falls back to the embedded file.
func Build(ctx context.Context, opts Options) (*Result, error) {
	if err := os.MkdirAll(opts.OutDir, 0o755); err != nil {
		return nil, err
	}
	tagBanks, nameBanks, err := loadBanks(opts.GameRoot)
	if err != nil {
		return nil, fmt.Errorf("eventsounds: %w", err)
	}
	res := &Result{Manifest: &Manifest{Version: ManifestVersion, Sounds: map[string]Take{}}}
	for _, s := range Sounds {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		var bank *wwise.Bank
		if s.Tag != 0 {
			bank = tagBanks[s.Tag]
		} else {
			bank = nameBanks[wwise.ID(s.Name)]
		}
		if bank == nil {
			res.Missing = append(res.Missing, s.Stem)
			continue
		}
		n, err := extract(bank, s, opts.OutDir, res.Manifest.Sounds)
		if err != nil {
			return nil, fmt.Errorf("eventsounds: %s: %w", s.Stem, err)
		}
		if n == 0 {
			res.Missing = append(res.Missing, s.Stem)
		}
		res.Files += n
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
	slog.InfoContext(ctx, "event sounds extracted", "files", res.Files, "missing", res.Missing)
	return res, nil
}

// extract writes one sound's media as one or more Ogg files (stem, stem_v2, ... up to
// s.Variants, or just stem when Variants is 0 or 1) into sounds, and returns how many it wrote.
func extract(bank *wwise.Bank, s Sound, outDir string, sounds map[string]Take) (int, error) {
	media := bank.EventMedia(s.Event)
	if s.Media != 0 {
		media = filterMedia(media, s.Media)
	}
	if len(media) == 0 {
		return 0, nil
	}
	want := s.Variants
	if want < 1 {
		want = 1
	}
	if want > len(media) {
		want = len(media)
	}
	written := 0
	for i := 0; i < want; i++ {
		stem := s.Stem
		if i > 0 {
			stem = fmt.Sprintf("%s_v%d", s.Stem, i+1)
		}
		raw, ok := bank.Embedded[media[i]]
		if !ok {
			continue
		}
		f, err := wwise.ParseMediaFormat(raw)
		if err != nil || f.Codec != wwise.CodecVorbis {
			continue
		}
		ogg, err := wwvorbis.Repack(raw)
		if err != nil {
			return written, fmt.Errorf("media %d: %w", media[i], err)
		}
		file := stem + ".ogg"
		if err := os.WriteFile(filepath.Join(outDir, file), ogg.Ogg, 0o644); err != nil {
			return written, err
		}
		sounds[stem] = Take{File: file, Event: s.Event, Media: media[i], DurationMs: ogg.DurationMs()}
		written++
	}
	return written, nil
}

// filterMedia returns only want among media, when present; otherwise the original list (the
// caller skips a media id the event does not actually play).
func filterMedia(media []uint32, want uint32) []uint32 {
	for _, m := range media {
		if m == want {
			return []uint32{m}
		}
	}
	return nil
}

// loadBanks returns every bank this package's sounds reach: by tag id (extracted directly) and
// by name (found by scanning), in one pass of the platform globals modules.
func loadBanks(gameRoot string) (byTag map[uint32]*wwise.Bank, byName map[uint32]*wwise.Bank, err error) {
	wantTags := map[uint32]bool{}
	wantNames := map[uint32]bool{}
	for _, s := range Sounds {
		if s.Tag != 0 {
			wantTags[s.Tag] = true
		} else {
			wantNames[wwise.ID(s.Name)] = true
		}
	}
	var paths []string
	for _, dir := range bankDirs(gameRoot) {
		p, err := filepath.Glob(filepath.Join(dir, "*.module"))
		if err != nil {
			return nil, nil, err
		}
		paths = append(paths, p...)
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		return nil, nil, err
	}
	byTag = map[uint32]*wwise.Bank{}
	for tag := range wantTags {
		raw, err := ix.Extract(tag)
		if err != nil {
			continue // not in this install; the sound stays missing, never an error
		}
		at := wwise.IndexBKHD(raw)
		if at < 0 {
			continue
		}
		bk, err := wwise.ParseBank(raw[at:])
		if err != nil {
			continue
		}
		byTag[tag] = bk
	}
	byName, err = findBanksByName(bankDirs(gameRoot), wantNames)
	if err != nil {
		return nil, nil, err
	}
	return byTag, byName, nil
}

var errFound = errors.New("found")

// findBanksByName returns the banks of the wanted name hashes found among the `sbnk` tags of the
// given module folders, in one pass per folder that stops once every wanted bank is found: the
// same scan internal/uisounds.go runs for its own banks.
func findBanksByName(dirs []string, wanted map[uint32]bool) (map[uint32]*wwise.Bank, error) {
	found := map[uint32]*wwise.Bank{}
	if len(wanted) == 0 {
		return found, nil
	}
	for _, dir := range dirs {
		paths, err := filepath.Glob(filepath.Join(dir, "*.module"))
		if err != nil {
			return nil, err
		}
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
