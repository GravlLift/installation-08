// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// atlas.go — the one exported extraction: one full-color image of one bitm atlas tag,
// for the builds outside this package that decode a game bitmap the same way the icon
// builds do (the rank badges).

package weaponicons

import (
	"fmt"
	"image"

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
	blob, px, im, err := resBlob(ix, id, idx)
	if err != nil {
		return nil, err
	}
	bw, bh := (im.W+3)/4, (im.H+3)/4
	need := bw * bh * 16
	if px+need > len(blob) {
		return nil, fmt.Errorf("mip0 overflows the resource (%d+%d > %d)", px, need, len(blob))
	}
	src, _, _, _ := decodeBC7(blob[px:px+need], im.W, im.H, mipGuide(blob, px, im.W, im.H))
	return src, nil
}
