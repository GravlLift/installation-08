// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package ambience extracts each multiplayer map's ambient beds ("room tones") from the user's
// game install. A map's level tag (`levl`) holds a palette of background sounds, one entry per
// acoustic zone of the map: each zone names a looping sound tag (`lsnd`) and a floor polygon with
// a height, the volume the zone occupies; the looping sound names a Wwise play event, and the
// event plays one long quad (4-channel) Wwise Vorbis loop authored to repeat end to end. The
// build writes, per map, every distinct loop the zones name as an Ogg Vorbis file (repacked
// without decoding, internal/wwvorbis) and a manifest the server reads; the loop of the zone with
// the largest volume is the map's fallback bed. Nothing is committed to the repo: the files land
// in the data directory's sound folder, next to the announcer's and the reloads'.
//
// The game plays the bed of the zone the listener stands in; the viewer switches beds by camera
// position using the zone shapes the manifest carries. The positional emitters (a separate
// palette) are not read.
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
const ManifestVersion = 2

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

// Bed is one map's ambient beds: the fallback looping sound (the loop of the zone with the
// largest volume), how many palette zones name a background sound and how many distinct ones
// they name, the takes the fallback's event plays, every extracted loop, and the shapes of the
// zones whose loop was extracted.
type Bed struct {
	Loop   string            `json:"loop"`
	Zones  int               `json:"zones"`
	Beds   int               `json:"beds"`
	Takes  []Take            `json:"takes"`
	Loops  map[string][]Take `json:"loops"`
	Shapes []Shape           `json:"shapes"`
}

// Shape is one acoustic zone's floor polygon and volume: what the viewer tests the camera
// position against to pick a bed.
type Shape struct {
	Zone   int          `json:"zone"`
	Loop   string       `json:"loop"`
	Floor  float64      `json:"floor"`
	Height float64      `json:"height"`
	Points [][2]float64 `json:"points"`
}

// Layout is what the viewer needs to switch beds by camera position: the fallback loop (played
// where no zone holds the camera), the first take file of every extracted loop, and the zone
// shapes.
type Layout struct {
	Fallback string // loop id, a key of Files
	Files    map[string]string
	Zones    []Shape
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

// Layout returns what the viewer needs to pick a bed by camera position for a map: the fallback
// loop, the first take file of every extracted loop, and the zone shapes. It is false when the
// map has no bed.
func (m *Manifest) Layout(mapKey string) (Layout, bool) {
	bed, ok := m.Maps[mapKey]
	if !ok || len(bed.Takes) == 0 {
		return Layout{}, false
	}
	files := map[string]string{}
	for loop, takes := range bed.Loops {
		if len(takes) == 0 {
			continue
		}
		files[loop] = takes[0].File
	}
	if _, ok := files[bed.Loop]; !ok {
		files[bed.Loop] = bed.Takes[0].File
	}
	return Layout{Fallback: bed.Loop, Files: files, Zones: bed.Shapes}, true
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
		for _, takes := range bed.Loops {
			for _, t := range takes {
				keep[t.File] = true
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
			return removed, fmt.Errorf("ambience: remove stale take: %w", err)
		}
		removed++
	}
	return removed, nil
}
