package decfilm

import (
	"encoding/json"
	"fmt"
)

// LoadMapQuantCatalogBytes reads the map bounds catalog from its bytes, for a catalog
// embedded in the binary. [where] names the origin in error messages. It applies the same
// schema check as [LoadMapQuantCatalog].
//
// Added for the standalone port (infinite-theater-3d); not in upstream.
func LoadMapQuantCatalogBytes(where string, blob []byte) (*MapQuantCatalog, error) {
	var c MapQuantCatalog
	if err := json.Unmarshal(blob, &c); err != nil {
		return nil, fmt.Errorf("invalid map bounds catalog (%s): %w", where, err)
	}
	if c.SchemaVersion != MapQuantSchemaVersion {
		return nil, fmt.Errorf("map bounds catalog is version %d, expected %d (%s)",
			c.SchemaVersion, MapQuantSchemaVersion, where)
	}
	return &c, nil
}
