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
)

// ManifestName is the file the viewer reads to learn which foot step sounds were extracted.
const ManifestName = "footsteps.json"

// ManifestVersion is the manifest's format version; a manifest of an older version is stale and
// the extraction runs again.
const ManifestVersion = 1

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
	// Movement maps a movement sound ("land", "landhard", "slide_into", "jumpup") to its takes;
	// the slide and slide_outof tags are left out on purpose (tags.go says why).
	Movement map[string]Footstep `json:"movement"`
}

// Footstep is the set of takes one sound draws from.
type Footstep struct {
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
