// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package mapref embeds the shipped reference data needed to resolve a native map's build
// target: the objectives catalog (anchor positions per map name), the per-map background
// sidecar (name list and world-frame calibration), and the per-map geometry overrides.
//
// This data is not extracted from a local game installation: the objectives catalog is built
// from publicly downloadable UGC map variants, and the background sidecars are measurements
// recorded when LevelUp (the project this tool is ported from) baked each map's background
// image. It ships inside the binary so build-mesh works without any extra file alongside it.
package mapref

import (
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"strings"

	"github.com/JGtm/halo-infinite-film-decoder/replay"
)

//go:embed data
var data embed.FS

// LoadObjectives reads the embedded catalog of per-map objective anchors. The schema version
// check mirrors replay.LoadMapObjectives (unavailable here: it only reads from a file path, and
// this data is embedded in the binary instead).
func LoadObjectives() (*replay.MapObjectivesCatalog, error) {
	blob, err := data.ReadFile("data/map_objectives.json")
	if err != nil {
		return nil, fmt.Errorf("mapref: objectives catalog: %w", err)
	}
	var c replay.MapObjectivesCatalog
	if err := json.Unmarshal(blob, &c); err != nil {
		return nil, fmt.Errorf("mapref: objectives catalog: %w", err)
	}
	if c.SchemaVersion != replay.MapObjectivesSchemaVersion {
		return nil, fmt.Errorf("mapref: objectives catalog in schema %d, want %d", c.SchemaVersion, replay.MapObjectivesSchemaVersion)
	}
	return &c, nil
}

// LoadBackground reads the embedded background sidecar for the given module key ("sgh_blueprint",
// for example).
func LoadBackground(module string) (*replay.MapBackground, error) {
	blob, err := data.ReadFile("data/map_backgrounds/" + module + ".json")
	if err != nil {
		return nil, fmt.Errorf("mapref: background of %q: %w", module, err)
	}
	var b replay.MapBackground
	if err := json.Unmarshal(blob, &b); err != nil {
		return nil, fmt.Errorf("mapref: background of %q: %w", module, err)
	}
	if b.SchemaVersion != replay.MapBackgroundSchemaVersion {
		return nil, fmt.Errorf("mapref: background of %q in schema %d, want %d", module, b.SchemaVersion, replay.MapBackgroundSchemaVersion)
	}
	return &b, nil
}

// GeometryOverride reports the deported geometry module of `module`, relative to the game
// install root, from the embedded per-map settings. Empty, nil means the map carries its own
// geometry (the common case).
func GeometryOverride(module string) (string, error) {
	blob, err := data.ReadFile("data/map_fond_reglages.json")
	if err != nil {
		return "", fmt.Errorf("mapref: map settings: %w", err)
	}
	var settings struct {
		Cartes map[string]struct {
			ModuleGeometrie string `json:"moduleGeometrie"`
		} `json:"cartes"`
	}
	if err := json.Unmarshal(blob, &settings); err != nil {
		return "", fmt.Errorf("mapref: map settings: %w", err)
	}
	return settings.Cartes[module].ModuleGeometrie, nil
}

// DefaultForgeMaterials returns the embedded Forge material tints catalog (JSON), copied
// unmodified from LevelUp's data/titles/halo_infinite/reference/forge_materials.json (see
// NOTICE.md). Used by build-variant when --forge-materials is not given.
func DefaultForgeMaterials() ([]byte, error) {
	blob, err := data.ReadFile("data/forge_materials.json")
	if err != nil {
		return nil, fmt.Errorf("mapref: forge materials: %w", err)
	}
	return blob, nil
}

// DefaultForgeObjects returns the embedded Forge object visibility catalog (JSON), copied
// unmodified from LevelUp's data/titles/halo_infinite/reference/forge_objects.json (see
// NOTICE.md). Used by build-variant when --forge-objects is not given.
func DefaultForgeObjects() ([]byte, error) {
	blob, err := data.ReadFile("data/forge_objects.json")
	if err != nil {
		return nil, fmt.Errorf("mapref: forge objects: %w", err)
	}
	return blob, nil
}

// BackgroundKeys lists every embedded background sidecar's module key, for callers that need to
// walk the whole catalog (tests, mainly).
func BackgroundKeys() ([]string, error) {
	entries, err := fs.ReadDir(data, "data/map_backgrounds")
	if err != nil {
		return nil, err
	}
	var keys []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") {
			keys = append(keys, strings.TrimSuffix(e.Name(), ".json"))
		}
	}
	return keys, nil
}
