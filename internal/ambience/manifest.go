// Package ambience extracts each multiplayer map's ambient bed (its "room tone") from the user's
// game install. A map's level tag (`levl`) holds a palette of background sounds, one entry per
// acoustic zone of the map, each naming a looping sound tag (`lsnd`); the looping sound names a
// Wwise play event, and the event plays one long quad (4-channel) Wwise Vorbis loop authored to
// repeat end to end. The build writes, per map, the loop of the zone the palette uses most as an
// Ogg Vorbis file (repacked without decoding, internal/wwvorbis) and a manifest the server reads.
// Nothing is committed to the repo: the files land in the data directory's sound folder, next to
// the announcer's and the reloads'.
//
// The game switches beds as the listener moves between zones and also places positional
// emitters (a separate palette); the viewer plays the single main bed, non-positional.
package ambience

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
)

// ManifestName is the file the server reads to find a map's extracted bed.
const ManifestName = "ambience.json"

// ManifestVersion is the manifest's format version; a manifest of an older version is stale and
// the extraction runs again.
const ManifestVersion = 1

// takeFile is the name of every take file a manifest lists: ambience_<media id, 8 hex digits>.ogg.
// A rebuild removes the ones its manifest no longer lists, and no other file.
var takeFile = regexp.MustCompile(`^ambience_[0-9a-f]{8}\.ogg$`)

// takeName is the file name of a media's take.
func takeName(mediaID uint32) string { return fmt.Sprintf("ambience_%08x.ogg", mediaID) }

// Manifest lists the extracted beds by map module key (e.g. "fo09_academy").
type Manifest struct {
	Version int            `json:"version"`
	Maps    map[string]Bed `json:"maps"`
}

// Bed is one map's ambient bed: the looping sound chosen, how many palette zones name a
// background sound and how many distinct ones they name, and the takes its event plays.
type Bed struct {
	Loop  string `json:"loop"`
	Zones int    `json:"zones"`
	Beds  int    `json:"beds"`
	Takes []Take `json:"takes"`
}

// Take is one extracted media.
type Take struct {
	File       string `json:"file"`
	Media      uint32 `json:"media"`
	DurationMs int    `json:"durationMs"`
	Channels   int    `json:"channels"`
}

// ManifestStatus reads the manifest in dir: built when it is there and readable, stale when its
// version is older than ManifestVersion.
func ManifestStatus(dir string) (built, stale bool) {
	m, err := ReadManifest(dir)
	if err != nil {
		return false, false
	}
	return true, m.Version < ManifestVersion
}

// ReadManifest reads the manifest in dir.
func ReadManifest(dir string) (*Manifest, error) {
	raw, err := os.ReadFile(filepath.Join(dir, ManifestName))
	if err != nil {
		return nil, err
	}
	var m Manifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("ambience: %s: %w", ManifestName, err)
	}
	return &m, nil
}

// BedFile returns the file of a map's bed (its first take), false when the map has none.
func (m *Manifest) BedFile(mapKey string) (string, bool) {
	bed, ok := m.Maps[mapKey]
	if !ok || len(bed.Takes) == 0 || !takeFile.MatchString(bed.Takes[0].File) {
		return "", false
	}
	return bed.Takes[0].File, true
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
	for _, bed := range m.Maps {
		for _, t := range bed.Takes {
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
			return removed, fmt.Errorf("ambience: remove stale take: %w", err)
		}
		removed++
	}
	return removed, nil
}
