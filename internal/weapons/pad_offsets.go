// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weapons

// pad_offsets.go: how a weapon or equipment pad holds its item. Every weapon and equipment pickup
// model carries a `weapon_pad_offset` marker (StringID 0xc20be2c5), read on the installed game
// 2026-11-20: the weapons' (S7, Bandit, Assault Rifle) sit at their middle with no rotation; the
// equipment's turn the item, the Shroud Screen upright with its deploying tip down, the Repulsor's
// disc on its edge, the Thruster and the Grapple lying on their side, as the owner's in-game
// captures show them. The view poses the item so that this marker's frame is the pad's holding
// frame. The marker is read in model space at the rest pose (its node's chain, then the marker),
// in GLB axes, like the effects' markers (`markerFrame`).

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/JGtm/halo-infinite-map-images/himap"
	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"
)

// readGroundScales reads the ground scale of each model key's object tag (a weapon or an equipment
// pickup object, `weaponicons.ReadGroundScale`): the scale the game draws the item at while it lies
// in the world or floats on a pad. A key whose tag does not read is left out (the view draws it at
// its model's own size).
func readGroundScales(ctx context.Context, gameRoot, module string, keys []string) (map[string]float64, error) {
	paths, err := himap.GeometrySearchPathMonde(gameRoot, module)
	if err != nil {
		return nil, err
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		return nil, fmt.Errorf("item tag index: %w", err)
	}
	defer func() {
		if err := ix.Close(); err != nil {
			slog.WarnContext(ctx, "closing item tag index", "err", err)
		}
	}()
	out := make(map[string]float64, len(keys))
	for _, key := range keys {
		id, err := parseKey(key)
		if err != nil {
			continue
		}
		raw, err := ix.Extract(id)
		if err != nil {
			continue
		}
		s, err := weaponicons.ReadGroundScale(raw)
		if err != nil {
			slog.WarnContext(ctx, "item without ground scale", "key", key, "err", err)
			continue
		}
		out[key] = s
	}
	slog.InfoContext(ctx, "ground scales read", "items", len(keys), "with_scale", len(out))
	return out, nil
}

// markerWeaponPadOffset is the StringID of `weapon_pad_offset`.
const markerWeaponPadOffset = 0xc20be2c5

// PadOffset is a model's `weapon_pad_offset` marker frame in model space (GLB axes): its position
// and its rotation quaternion (x, y, z, w).
type PadOffset struct {
	P [3]float64 `json:"p"`
	Q [4]float64 `json:"q"`
}

// readPadOffsets reads the pad marker of each model key's object (a weapon or an equipment pickup
// object): its render model's first `weapon_pad_offset` instance. A key whose model or marker cannot
// be read is left out (the view keeps its own pose for it).
func readPadOffsets(ctx context.Context, a *himap.Arsenal, keys []string) map[string]PadOffset {
	out := map[string]PadOffset{}
	for _, key := range keys {
		id, err := parseKey(key)
		if err != nil {
			continue
		}
		mode, ok := a.ModeleDeLArme(id)
		if !ok {
			continue
		}
		ms, err := a.MarqueursDuModele(mode, map[uint32]bool{markerWeaponPadOffset: true})
		if err != nil || len(ms) == 0 {
			if err != nil {
				slog.DebugContext(ctx, "pad offset unreadable", "key", key, "err", err)
			}
			continue
		}
		p, q := markerFrame(ms[0].Model)
		out[key] = PadOffset{P: p, Q: q}
	}
	return out
}
