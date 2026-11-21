// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

// groundscale.go — THE SCALE AN ITEM TAKES IN THE WORLD, read from its `weap` or `eqip` tag.
//
// The `item` struct both groups share (object -> item -> weapon or equipment) carries an "Item
// scale settings" block: `ground scale`, then the armed and stowed scales for small, medium, large
// and huge units (Z-15/Halo-Infinite-Tag-Editor's eqip layout, which names the fields but gives no
// offsets). The game draws an item lying in the world, a pad's item included, at its ground scale.
//
// WHERE IT IS (measured on the installed game, 2026-11-20). The field sits at +0x7cc of the tag's
// root struct, the same in every `eqip` (root 0x9f8 bytes) and every `weap` (root 0x1198 bytes):
// the object and item prefix is shared. Read there: the S7, Bandit, Assault Rifle and Sidekick 1.3,
// the Shroud Screen 1.5, the Repulsor 1.8, the Thruster 2.25, the Grapple 2.75, Active Camo 2, the
// Drop Wall 1; each followed by its eight unit scales (an equipment's 0 1 0 1 0 1 0 0.001, a
// weapon's 0.85 0.85 1 1 1.3 1.3 0 0 or so). The read checks that shape: the scale positive, the
// eight that follow finite and within [0, 10]; otherwise it is an error, never a guess.

package weaponicons

import (
	"encoding/binary"
	"fmt"
	"math"
)

// groundScaleOffset is the field's offset in the root struct; groundScaleFollowers the unit scales
// after it that the shape check reads.
const (
	groundScaleOffset    = 0x7cc
	groundScaleFollowers = 8
)

// ReadGroundScale reads an item tag's (`weap`, `eqip`) ground scale.
func ReadGroundScale(tag []byte) (float64, error) {
	w, err := openWeapTag(tag)
	if err != nil {
		return 0, err
	}
	root, err := w.rootBlock()
	if err != nil {
		return 0, err
	}
	abs, size := w.blockAbs(root)
	end := groundScaleOffset + 4*(1+groundScaleFollowers)
	if abs < 0 || size < end || abs+end > len(tag) {
		return 0, fmt.Errorf("root struct of %#x bytes holds no item scale settings", size)
	}
	f := func(k int) float64 {
		return float64(math.Float32frombits(binary.LittleEndian.Uint32(tag[abs+groundScaleOffset+4*k:])))
	}
	scale := f(0)
	if !(scale > 0 && scale <= 10) {
		return 0, fmt.Errorf("ground scale %g out of range", scale)
	}
	for k := 1; k <= groundScaleFollowers; k++ {
		if v := f(k); math.IsNaN(v) || v < 0 || v > 10 {
			return 0, fmt.Errorf("unit scale %d reads %g: not the item scale settings", k, v)
		}
	}
	return scale, nil
}
