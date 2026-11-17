// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// Package refdata ships the reference catalogs a standalone decode needs, embedded in the
// binary: the user owns no reference files of their own, so the catalogs travel with the
// program. The map quantization catalog is LevelUp's reference catalog, copied in and
// rebuilt with it; an explicit catalog path (see cmd) always wins over the embedded copy.
package refdata

import (
	_ "embed"

	"github.com/JGtm/halo-infinite-film-decoder/decfilm"
)

//go:embed data/map_quant_bounds.json
var mapQuantBoundsJSON []byte

// embeddedProvenance names the embedded catalog in the decoder's error messages (it has no
// file path, so a marker takes the place of one).
const embeddedProvenance = "embedded map_quant_bounds.json"

// MapQuantBounds returns the embedded map quantization catalog, parsed: the map world
// bounds and the axis widths the quantized coordinates are dequantized with.
func MapQuantBounds() (*decfilm.MapQuantCatalog, error) {
	return decfilm.LoadMapQuantCatalogBytes(embeddedProvenance, mapQuantBoundsJSON)
}
