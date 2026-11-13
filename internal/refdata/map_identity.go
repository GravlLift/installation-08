package refdata

// map_identity.go — the map identity the film carries on its own: chunk_00 gives a map
// asset id and a map version id, nothing else. This table, keyed by map asset id, says what
// that map is: its display name, the key of its entry in the bounds catalog (map_quant_
// bounds.json, by normalized display name), and the module key of its geometry (the
// installed module folder, or for a Forge map its canvas module). Generated from LevelUp's
// reference catalogs (see NOTICE.md); the decoder's own NormalizeMapName is the single rule
// that turns a display name into a bounds key.

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

//go:embed data/map_identity.json
var mapIdentityJSON []byte

// MapIdentity is the row the table holds for one map asset id.
type MapIdentity struct {
	// Name is the map's display name as the game writes it.
	Name string `json:"name"`
	// BoundsKey is the normalized display name: the key of the bounds catalog.
	BoundsKey string `json:"boundsKey"`
	// Module is the geometry module key (installed module folder, or the Forge canvas
	// module). Absent in the JSON (and empty here) for a map LevelUp has not proven to a
	// module yet.
	Module string `json:"module,omitempty"`
	// Canvas is the Forge canvas module of a Forge map; absent in the JSON (and empty
	// here) for a native map.
	Canvas string `json:"canvas,omitempty"`
	// Source names which reference file established the row.
	Source string `json:"source"`
	// Aliases are the other display names the same asset id carried.
	Aliases []string `json:"aliases"`
}

// mapIdentityTable is the shipped form of the table (schema-guarded, like the bounds
// catalog).
type mapIdentityTable struct {
	SchemaVersion int                    `json:"schemaVersion"`
	Source        string                 `json:"source"`
	Maps          map[string]MapIdentity `json:"maps"`
}

const mapIdentitySchemaVersion = 1

// identityTable parses the embedded table once, for every lookup in the process. An
// unparseable table is a build defect (the embed is guarded by a test), never a user input.
var identityTable = parseMapIdentity()

// parseMapIdentity loads the table; nil when it does not parse (the embed is versioned and
// tested, so this path is a build defect).
func parseMapIdentity() *mapIdentityTable {
	var t mapIdentityTable
	if err := json.Unmarshal(mapIdentityJSON, &t); err != nil {
		return nil
	}
	if t.SchemaVersion != mapIdentitySchemaVersion {
		return nil
	}
	return &t
}

// LookupMapIdentity resolves a map asset id (the film's CarteAssetID, lowercase GUID form)
// to its identity. The id is compared case-insensitively, as a GUID.
func LookupMapIdentity(assetID string) (MapIdentity, error) {
	if identityTable == nil {
		return MapIdentity{}, fmt.Errorf("embedded map identity table is unreadable: %w", errUnreadableIdentityTable)
	}
	id := strings.ToLower(strings.TrimSpace(assetID))
	e, ok := identityTable.Maps[id]
	if !ok {
		return MapIdentity{}, fmt.Errorf("map asset id %s is not in the identity table: pass --map with the display name of the map", id)
	}
	return e, nil
}

// errUnreadableIdentityTable is the build-defect error of an unparseable embedded table.
var errUnreadableIdentityTable = fmt.Errorf("map identity table embedded in the binary does not parse")

// AllMapIdentities lists the table's rows (asset id, display name), sorted by name then id:
// the coverage a caller reports on, and the test's walk.
func AllMapIdentities() []MapIdentity {
	if identityTable == nil {
		return nil
	}
	out := make([]MapIdentity, 0, len(identityTable.Maps))
	for _, e := range identityTable.Maps {
		out = append(out, e)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name != out[j].Name {
			return out[i].Name < out[j].Name
		}
		return false
	})
	return out
}

// MapIdentityCoverage tallies the table against the embedded bounds catalog: how many rows
// resolve to a bounds entry and to a module key, and which rows lack one.
func MapIdentityCoverage() (total, withBounds, withModule int, noBounds, noModule []string) {
	cat, err := MapQuantBounds()
	if err != nil {
		return 0, 0, 0, nil, []string{fmt.Sprintf("bounds catalog unreadable: %v", err)}
	}
	for _, e := range AllMapIdentities() {
		total++
		if _, err := cat.Lookup(e.BoundsKey); err == nil {
			withBounds++
		} else {
			noBounds = append(noBounds, e.Name)
		}
		if e.Module != "" {
			withModule++
		} else {
			noModule = append(noModule, e.Name)
		}
	}
	sort.Strings(noBounds)
	sort.Strings(noModule)
	return total, withBounds, withModule, noBounds, noModule
}
