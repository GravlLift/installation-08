package weapons

// reticle.go reads each weapon's red-reticle range from its `weap` tag (weaponicons.ReadAimAssist:
// the autoaim range and the zoom magnifications) for the library index. A weapon whose tag gives no
// range has no entry: the view never turns its reticle red.

import (
	"context"
	"fmt"
	"log/slog"
	"math"

	"github.com/llampwall/infinite-theater-3d/internal/weaponicons"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// ReticleRange is the distance within which a weapon's reticle turns red on an enemy, read from its
// `weap` tag: the autoaim range. World units (1 wu = 3.048 m).
type ReticleRange struct {
	// Unscoped is the range at the hip.
	Unscoped float64 `json:"unscoped"`
	// Zoomed is the range at each zoom level the tag declares (index = level - 1): Unscoped times
	// that level's magnification, or Unscoped when the tag sets "do not scale for magnification".
	// Empty for a weapon without a zoom level: zoomed, it keeps Unscoped.
	Zoomed []float64 `json:"zoomed"`
}

// rangeSteps is the number of rounding steps per world unit of a written range (0.0001 wu): a
// float32 field read as a float64 carries digits past the tag's own precision.
const rangeSteps = 1e4

// reticleRangeOf turns a weapon's aim-assist data into its index entry; false when the tag gives
// no autoaim range.
func reticleRangeOf(a weaponicons.AimAssist) (ReticleRange, bool) {
	if a.AutoaimRange <= 0 {
		return ReticleRange{}, false
	}
	r := ReticleRange{Unscoped: roundRange(a.AutoaimRange), Zoomed: []float64{}}
	for _, mag := range a.Magnifications {
		z := a.AutoaimRange
		if a.ScalesWithZoom {
			z *= mag
		}
		r.Zoomed = append(r.Zoomed, roundRange(z))
	}
	return r, true
}

func roundRange(v float64) float64 { return math.Round(v*rangeSteps) / rangeSteps }

// readReticleRanges reads the red-reticle range of every weapon key from the installed modules the
// map module's search path covers (the same modules the weapon models come from). The map is
// never nil. A weapon without a range is logged once and left out.
func readReticleRanges(ctx context.Context, gameRoot, module string, keys []string) (map[string]ReticleRange, error) {
	paths, err := himap.GeometrySearchPathMonde(gameRoot, module)
	if err != nil {
		return nil, err
	}
	ix, err := himap.NewModuleIndex(paths...)
	if err != nil {
		return nil, fmt.Errorf("weapon tag index: %w", err)
	}
	defer func() {
		if err := ix.Close(); err != nil {
			slog.WarnContext(ctx, "closing weapon tag index", "err", err)
		}
	}()
	out := make(map[string]ReticleRange, len(keys))
	for _, key := range keys {
		r, err := reticleRangeOfKey(ix, key)
		if err != nil {
			slog.WarnContext(ctx, "weapon without red reticle range", "weapon", key, "err", err)
			continue
		}
		out[key] = r
	}
	slog.InfoContext(ctx, "red reticle ranges read", "weapons", len(keys), "with_range", len(out))
	return out, nil
}

// reticleRangeOfKey reads one weapon's range; an error says why it has none.
func reticleRangeOfKey(ix *himap.ModuleIndex, key string) (ReticleRange, error) {
	id, err := parseKey(key)
	if err != nil {
		return ReticleRange{}, err
	}
	raw, err := ix.Extract(id)
	if err != nil {
		return ReticleRange{}, err
	}
	a, err := weaponicons.ReadAimAssist(raw)
	if err != nil {
		return ReticleRange{}, err
	}
	r, ok := reticleRangeOf(a)
	if !ok {
		return ReticleRange{}, fmt.Errorf("the tag's autoaim range is 0")
	}
	return r, nil
}
