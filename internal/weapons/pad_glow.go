// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.

package weapons

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/JGtm/halo-infinite-map-images/himap"
)

// equipmentPadEffect is the equipment pad's glow effect. The pad's Forge kit (`foki e444bcc9`,
// forge_objects module) holds the pad device (`mach 58f5b4af`), this effect (+0x1ce0) and the
// script that plays it ("spawnedParticleFX"); the effect names a location marker (54b94882) the
// device's model does not carry, so it plays at the device's origin (the engine's fallback, an
// inference). Its one rendering level (camera 1 to 30) holds two events played in turn and
// looped: event 0 (delay 0.5 s, 0.5 s) creates the upward cone generator (`efge 48e03d70`, not
// drawn yet), a cheap light and a lens flare; event 1 (1 s) a second cheap light, a bluer lens
// flare, a distortion particle and a sound.
const equipmentPadEffect = 0xcf098056

// PadGlow is the equipment pad's glow, as the view draws it: the effect's events in play order,
// each with its cheap lights and lens flares (each reflection with its fx-<bitmap>.png texture).
type PadGlow struct {
	Effect string `json:"effect"`
	// Looping: the effect restarts after its last event; Parallel: its events play together
	// instead of one after the other.
	Looping  bool       `json:"looping"`
	Parallel bool       `json:"parallel"`
	Events   []PadEvent `json:"events"`
}

// PadEvent is one event of the pad effect: its delay and duration bounds (seconds) and its parts.
type PadEvent struct {
	Delay    [2]float32         `json:"delay"`
	Duration [2]float32         `json:"duration"`
	Lights   []himap.CheapLight `json:"lights"`
	Flares   []PadFlare         `json:"flares"`
}

// PadFlare is one lens flare of the pad: its part's radius modifier, its root and its drawn
// reflections.
type PadFlare struct {
	Lens           string          `json:"lens"`
	RadiusModifier [2]float32      `json:"radiusModifier"`
	Flags          uint16          `json:"flags"`
	Falloff        [2]float32      `json:"falloff"` // falloff, cutoff angles (radians)
	FarFade        [2]float32      `json:"farFade"`
	NearFade       [2]float32      `json:"nearFade"`
	Reflections    []PadReflection `json:"reflections"`
}

// PadReflection is one drawn reflection, its texture, and whether the texture is sampled
// through an sRGB view (its bitmap's color space).
type PadReflection struct {
	himap.LensReflection
	Texture string `json:"texture"`
	SRGB    bool   `json:"srgb"`
}

// readPadGlow reads the equipment pad's glow and writes its textures into dir; nil when the game
// holds no readable one (the view draws none).
func readPadGlow(ctx context.Context, a *himap.Arsenal, dir string) *PadGlow {
	events, looping, parallel, err := a.EffectEventsOf(equipmentPadEffect)
	if err != nil {
		slog.WarnContext(ctx, "pad glow effect unreadable", "effe", fmt.Sprintf("%08x", equipmentPadEffect), "err", err)
		return nil
	}
	out := &PadGlow{Effect: fmt.Sprintf("%08x", equipmentPadEffect), Looping: looping, Parallel: parallel}
	w := effectWriter{a: a, dir: dir, written: map[string]bool{}}
	for _, ev := range events {
		pe := PadEvent{Delay: ev.Delay, Duration: ev.Duration}
		for _, part := range ev.Lights {
			l, err := a.CheapLightTag(part.Type)
			if err != nil {
				slog.WarnContext(ctx, "pad cheap light unreadable", "gldf", fmt.Sprintf("%08x", part.Type), "err", err)
				continue
			}
			pe.Lights = append(pe.Lights, *l)
		}
		for _, part := range ev.Lenses {
			if f, ok := padFlare(ctx, a, w, part); ok {
				pe.Flares = append(pe.Flares, f)
			}
		}
		out.Events = append(out.Events, pe)
	}
	return out
}

// padFlare reads one lens part and writes its reflections' textures; false when unreadable.
func padFlare(ctx context.Context, a *himap.Arsenal, w effectWriter, part himap.EffectPart) (PadFlare, bool) {
	l, err := a.LensFlareTag(part.Type)
	if err != nil {
		slog.WarnContext(ctx, "pad lens flare unreadable", "lens", fmt.Sprintf("%08x", part.Type), "err", err)
		return PadFlare{}, false
	}
	f := PadFlare{Lens: fmt.Sprintf("%08x", part.Type), RadiusModifier: part.Radius, Flags: l.Flags,
		Falloff: [2]float32{l.FalloffAngle, l.CutoffAngle}, FarFade: l.FarFade, NearFade: l.NearFade}
	for _, r := range l.Reflections {
		if r.Flags&himap.LensReflectionNoRender != 0 {
			continue
		}
		file, _, err := w.texture(r.Bitmap)
		if err != nil {
			slog.WarnContext(ctx, "pad flare texture unreadable", "bitm", fmt.Sprintf("%08x", r.Bitmap), "err", err)
			continue
		}
		srgb, _, err := a.EspaceBitmap(r.Bitmap)
		if err != nil {
			slog.WarnContext(ctx, "pad flare texture space unreadable", "bitm", fmt.Sprintf("%08x", r.Bitmap), "err", err)
			continue
		}
		f.Reflections = append(f.Reflections, PadReflection{LensReflection: r, Texture: file, SRGB: srgb})
	}
	return f, true
}
