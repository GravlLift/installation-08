// Package reloadsounds extracts the weapons' reload sounds from the user's game install. The
// game posts them from the Spartan's third-person reload animation of the held weapon's type
// (`<stance>:<class>:<type>:reload_1`): each sound event of that animation names a `snd!` tag at
// a frame, the tag names a Wwise event, and the event draws one of its media. The build writes
// every media as an Ogg Vorbis take (repacked without decoding, internal/wwvorbis) and a
// manifest the viewer reads: per weapon tag, per stance, the animation's length and each
// sound's moment and takes. The heat weapons (Stalker, Plasma Pistol, Pulse Carbine, Ravager)
// vent instead of reloading: their `vent_enter`, `vent_loop` and `vent_exit` animations are read
// the same way into the manifest's `vents`. Nothing is committed to the repo: the files land in
// the data directory's sound folder, next to the announcer's.
package reloadsounds

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

// ManifestName is the file the viewer reads to learn which weapons have extracted reload sounds.
const ManifestName = "reloads.json"

// ManifestVersion is the manifest's format version; a manifest of an older version is stale and
// the extraction runs again. Version 2 adds the heat weapons' vents, 3 the staged reloads'
// first-person sounds (Staged).
const ManifestVersion = 3

// takeFile is the name of every take file a manifest lists: reload_<media id, 8 hex digits>.ogg.
// A rebuild removes the ones its manifest no longer lists, and no other file.
var takeFile = regexp.MustCompile(`^reload_[0-9a-f]{8}\.ogg$`)

// takeName is the file name of a media's take.
func takeName(mediaID uint32) string { return fmt.Sprintf("reload_%08x.ogg", mediaID) }

// Manifest lists the extracted reloads by weapon tag (8 hex digits, the family id the film's
// weapon ids start with).
type Manifest struct {
	Version int `json:"version"`
	// Weapons maps a weapon tag to its reload animation per stance ("combat", "crouch").
	Weapons map[string]map[string]Reload `json:"weapons"`
	// Vents maps a heat weapon tag to its vent per stance: the enter, loop and exit animations,
	// each with the sounds it posts (the loop posts none in the installed game).
	Vents map[string]map[string]Vent `json:"vents"`
	// Staged maps a weapon whose first-person rig reloads in stages (reload_enter, one round per
	// stage, chamber_1: the Heatwave, Cindershot, Hydra) to the sounds its first-person reload clips
	// post that no other clip of its graph posts, each from the sound's first-person event.
	Staged map[string]Staged `json:"staged,omitempty"`
}

// Staged is one staged reload's first-person clips: the enter, a round (full and empty magazine),
// and the closing clip. A clip the rig does not carry is left empty.
type Staged struct {
	Enter      VentClip `json:"enter"`
	Round      VentClip `json:"round"`
	RoundEmpty VentClip `json:"roundEmpty"`
	Closing    VentClip `json:"closing"`
}

// Vent is one heat weapon's vent: the animation of each of its phases.
type Vent struct {
	Enter VentClip `json:"enter"`
	Loop  VentClip `json:"loop"`
	Exit  VentClip `json:"exit"`
}

// VentClip is one vent animation: its game name, its length, and the sounds it posts.
type VentClip struct {
	Animation  string  `json:"animation"`
	DurationMs int     `json:"durationMs"`
	Sounds     []Sound `json:"sounds"`
}

// MarshalJSON writes a clip that posts no sound (a vent loop) with an empty `sounds` list, never
// null: the viewer reads a clip as a length and a list, and refused the whole manifest, every
// reload of every weapon silenced, for the null its first vents wrote (2026-11-16).
func (c VentClip) MarshalJSON() ([]byte, error) {
	type plain VentClip
	if c.Sounds == nil {
		c.Sounds = []Sound{}
	}
	return json.Marshal(plain(c))
}

// Reload is one reload animation: its game name, its length, and the sounds it posts.
type Reload struct {
	Animation  string  `json:"animation"`
	DurationMs int     `json:"durationMs"`
	Sounds     []Sound `json:"sounds"`
}

// MarshalJSON writes an empty `sounds` list as [], as VentClip does.
func (r Reload) MarshalJSON() ([]byte, error) {
	type plain Reload
	if r.Sounds == nil {
		r.Sounds = []Sound{}
	}
	return json.Marshal(plain(r))
}

// Sound is a sound the animation posts at AtMs after its start; the game draws one of its takes.
type Sound struct {
	AtMs  int    `json:"atMs"`
	Takes []Take `json:"takes"`
}

// Take is one extracted media.
type Take struct {
	File       string `json:"file"`
	Media      uint32 `json:"media"`
	DurationMs int    `json:"durationMs"`
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

// writeManifest writes the manifest into dir.
func writeManifest(dir string, m *Manifest) error {
	raw, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, ManifestName), raw, 0o644)
}

// removeStaleTakes deletes the regular files of dir named like a take that m does not list, and
// returns how many it deleted. Nothing else in dir is touched, and nothing below it.
func removeStaleTakes(dir string, m *Manifest) (int, error) {
	keep := map[string]bool{}
	for _, stances := range m.Weapons {
		for _, r := range stances {
			for _, s := range r.Sounds {
				for _, t := range s.Takes {
					keep[t.File] = true
				}
			}
		}
	}
	for _, stances := range m.Vents {
		for _, v := range stances {
			for _, c := range []VentClip{v.Enter, v.Loop, v.Exit} {
				for _, s := range c.Sounds {
					for _, t := range s.Takes {
						keep[t.File] = true
					}
				}
			}
		}
	}
	for _, s := range m.Staged {
		for _, c := range []VentClip{s.Enter, s.Round, s.RoundEmpty, s.Closing} {
			for _, snd := range c.Sounds {
				for _, t := range snd.Takes {
					keep[t.File] = true
				}
			}
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
			return removed, fmt.Errorf("reloadsounds: remove stale take: %w", err)
		}
		removed++
	}
	return removed, nil
}
