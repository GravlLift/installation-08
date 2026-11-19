// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package footstepsounds extracts the Spartan's foot and movement sounds from the user's game
// install. The tags are known in advance (tags.go); the build follows each tag's third-person
// event to its media, writes every media as an Ogg Vorbis take (repacked without decoding,
// internal/wwvorbis) and a manifest the viewer reads: per surface and action, the takes, plus
// the movement sounds. Nothing is committed to the repo: the files land in the data directory's
// sound folder, next to the reloads' and the announcer's.
package footstepsounds

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	"github.com/llampwall/infinite-theater-3d/internal/soundtags"
)

// ManifestName is the file the viewer reads to learn which foot step sounds were extracted.
const ManifestName = "footsteps.json"

// ManifestVersion is the manifest's format version; a manifest of an older version is stale and
// the extraction runs again.
const ManifestVersion = 5

// takeFile is the name of every take file a manifest lists: foot_<media id, 8 hex digits>.ogg.
// A rebuild removes the ones its manifest no longer lists, and no other file.
var takeFile = regexp.MustCompile(`^foot_[0-9a-f]{8}\.ogg$`)

// takeName is the file name of a media's take.
func takeName(mediaID uint32) string { return fmt.Sprintf("foot_%08x.ogg", mediaID) }

// Manifest lists the extracted sounds.
type Manifest struct {
	Version int `json:"version"`
	// Feet maps a surface to its foot step sounds, action ("walk", "run", "sprint", "shuffle",
	// "slide", "land", "landhard") to the takes the game draws one of.
	Feet map[string]map[string]Footstep `json:"feet"`
	// Movement maps a movement sound ("land", "landhard", "slide_into", "slide_outof", "jumpup")
	// to its takes; the plain slide tag is left out on purpose (tags.go says why).
	Movement map[string]Footstep `json:"movement"`
	// Shots maps a weapon key ("hinf_bandit") to the game's own shot of that weapon, as other
	// players hear it: its layers (near, mid and far, each a random draw of takes) with their
	// volumes and falloffs (version 3, shots.go). A weapon whose shot is not found keeps the
	// shipped sound.
	Shots map[string]Footstep `json:"shots,omitempty"`
	// ShotsFirstPerson maps a weapon key to the same shot as its shooter hears it: the sound
	// tag's first-person event, heard in 2D (no falloff), with its own takes and volumes
	// (version 4).
	ShotsFirstPerson map[string]Footstep `json:"shotsFirstPerson,omitempty"`
	// Intro is the whole multiplayer theme the replay's intro plays the rise of, with its own ring-out
	// (version 5, intro.go); absent when the install lacks it.
	Intro *Take `json:"intro,omitempty"`
	// Falloffs maps an attenuation id (8 hex digits) a take names to its distance falloff
	// (version 3).
	Falloffs map[string]soundtags.Falloff `json:"falloffs,omitempty"`
}

// Footstep is the set of takes one sound draws from.
type Footstep struct {
	Takes []Take `json:"takes"`
	// Layers groups the takes (indexes into Takes) by what the game plays together: one take of
	// every layer sounds at once (a run step is three: the foot and two gear layers). Absent
	// before version 3, read then as one layer of every take.
	Layers [][]int `json:"layers,omitempty"`
}

// Take is one extracted media.
type Take struct {
	File       string `json:"file"`
	Media      uint32 `json:"media"`
	DurationMs int    `json:"durationMs"`
	// GainDB is the volume the game's mix hierarchy authors for the media (the sum of its node
	// chain's volumes), and Falloff the attenuation it plays with, a key of Manifest.Falloffs
	// ("" when none). Version 3.
	GainDB  float64 `json:"gainDb"`
	Falloff string  `json:"falloff,omitempty"`
	// ReverbDB is the level, against the take's own, at which it feeds the zone reverb: the sum of
	// its node chain's game-defined auxiliary sends (version 5).
	ReverbDB float64 `json:"reverbDb"`
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
	for _, actions := range m.Feet {
		for _, f := range actions {
			for _, t := range f.Takes {
				keep[t.File] = true
			}
		}
	}
	for _, f := range m.Movement {
		for _, t := range f.Takes {
			keep[t.File] = true
		}
	}
	if m.Intro != nil {
		keep[m.Intro.File] = true
	}
	for _, f := range m.ShotsFirstPerson {
		for _, t := range f.Takes {
			keep[t.File] = true
		}
	}
	for _, f := range m.Shots {
		for _, t := range f.Takes {
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
			return removed, fmt.Errorf("footstepsounds: remove stale take: %w", err)
		}
		removed++
	}
	return removed, nil
}
