// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// atlas.go — the one exported extraction: one full-color image of one bitm atlas tag,
// for the builds outside this package that decode a game bitmap the same way the icon
// builds do (the rank badges). The pixels are decoded through the shared bitmap decoder,
// with the format the bitmap's own header declares.

package weaponicons

import (
	"fmt"
	"image"

	"github.com/JGtm/halo-infinite-map-images/bitmapdecode"
	"github.com/JGtm/halo-infinite-map-images/himap"
)

// AtlasImage decodes image idx of the bitm tag id from the game install at gameRoot
// (empty auto-detects it the way the other builds always do), full color, as the game
// ships it (the icon builds' white-mass simplification is not applied).
func AtlasImage(gameRoot string, id uint32, idx int) (*image.NRGBA, error) {
	if moduleRoot(gameRoot) == "" {
		return nil, fmt.Errorf("game install not found: pass --game or set %s", himap.DeployRootEnv)
	}
	ix := buildIndex("")
	_, ok := pickRef(ix.byID[id])
	if !ok {
		return nil, fmt.Errorf("tag %08x not found in the install", id)
	}
	im, px, fm, ok := atlasImageInfo(ix, id, idx)
	if !ok {
		return nil, fmt.Errorf("atlas image %d of tag %08x not readable", idx, id)
	}
	return fm.Decode(px, im.W, im.H, bitmapdecode.Tight)
}
