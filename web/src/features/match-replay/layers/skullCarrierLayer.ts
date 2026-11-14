/**
 * skullCarrierLayer.ts — THE CARRIER OF THE ODBALL SKULL (schema 23), frame by frame.
 *
 * WHY IT LIVES BESIDE `vipCrownLayer` AND `flagCarriesLayer`. Same sharing: the marker follows
 * its carrier frame by frame (the carrier runs, the period only publishes an interval), so it is
 * painted AT EVERY FRAME, on the RE-READ position of the player — never at a frozen position.
 *
 * WHAT THIS LAYER SAYS, AND NOTHING MORE: WHO carries the skull at this frame. A run of mode
 * score ticks of the same player IS a carry period. A SINGLE skull: at most one carrier at a
 * time (unlike the VIP crown, of which each side has its own).
 *
 * `closed` false = NOTHING dates the end of the carry: the run of ticks runs to the end of the
 * axis (the film stops during the carry), an UPPER BOUND. The glyph is then FAINT — the
 * uncertainty is on screen, not in a note.
 *
 * THE FREE SKULL (`objectiveObjectsLayer`) DRAWS THE SKULL PLACED ON THE GROUND when NO ONE
 * carries it; this layer draws it ON ITS CARRIER. The two are never active at the same instant
 * for the same skull: between two free lives there is a carry, and that is exactly the interval
 * this layer fills. The glyph is the SAME — the shared one of `skullGlyph.ts` — so that one
 * recognizes the same object; only its place changes (on the ground / above a player).
 *
 * ITS DRESSING IS THAT OF THE FLAG since 2026-08-28 (rim in the ink of the background, enlarged
 * size, two orbits): the why, the cote and the limit (the game icon exists but is not cooked in
 * the document) live in the header of `skullGlyph.ts`. No text: the carrier is already named by
 * their marker.
 */
import { type XY } from '../../../lib/replay/replayLogic'
import { drawSkullGlyph } from './skullGlyph'

import { type CanvasView, projectTo } from '../model/replayView'
import { edgeMarkFor, OFFSCREEN_MARGIN_PX } from '../model/edgeClamp'
import type { ReplaySkullCarry } from '../../../lib/replay/replayNormalize'
import { carriedGlyphAlpha } from './carriedGlyphPulse'
import { covers } from '../model/replaySpans'

/** Style of the layer: the inks are RESOLVED by the caller (color-tokens rule). */
export interface SkullCarrierStyle {
  /** Ink of the skull disc (theme token already resolved by the caller). */
  ink: string
  /** Ink of the BACKGROUND: the rim of the skull, like that of the flag (`skullGlyph.ts`). */
  outline: string
  /** Reduced motion: the pulsation of an "open" carry becomes a constant opacity. */
  reducedMotion: boolean
}

/**
 * SkullCarrierInput — what the layer receives from the caller (`useReplaySkullCarrier`).
 *
 * `posOf` is THE reason for being of this field: the skull draws on the marker of its carrier at
 * the current frame. The layer does not know how to re-read a trajectory — the caller passes
 * it the reading.
 */
export interface SkullCarrierInput {
  style: SkullCarrierStyle
  /** World position of the player at a frame, or `null` if they are not locatable. */
  posOf: (xuid: string, frame: number) => XY | null
}

/** Vertical offset above the point of the player (the marker occupies the point itself). */
const SKULL_OFFSET_Y = 12


/** POTENTIAL HOVER radius, in pixels: exported for a future hover, not consumed here. */
export const SKULL_CARRIER_HIT_RADIUS = 10

/**
 * skullCarrierActiveAt returns the carries that COVER the requested frame. A SINGLE skull: at
 * most one, but a list is returned (like the sibling layers) for a uniform tracing. PURE
 * FUNCTION, tested apart.
 */
export function skullCarrierActiveAt(
  carries: readonly ReplaySkullCarry[],
  frame: number,
): ReplaySkullCarry[] {
  const out: ReplaySkullCarry[] = []
  for (const c of carries) {
    if (covers(c, frame)) out.push(c)
  }
  return out
}

/**
 * drawSkullCarrier paints, ON TOP of the markers, the skull on its current carrier.
 *
 * A non-locatable carrier (unpublished life, frame outside their trajectories) is NOT drawn:
 * the carried skull has no position of its own, and inventing one would assert a place the film
 * does not give at this frame.
 *
 * OFF-SCREEN BOUNDING (off-screen squad plan, work site B, decision D3, 2026-09-10): the
 * CARRIED skull is pinned to the margin when its carrier leaves the visible framing — the FREE
 * skull (placed on the ground, `objectiveObjectsLayer.ts`) is a map object, outside the scope
 * decided here.
 */
export function drawSkullCarrier(
  ctx: CanvasRenderingContext2D,
  layer: SkullCarrierInput,
  carries: readonly ReplaySkullCarry[],
  view: CanvasView,
  frame: number,
): void {
  for (const c of skullCarrierActiveAt(carries, frame)) {
    const w = layer.posOf(c.xuid, frame)
    if (!w) continue
    // SCALE 1: this layer does not yet scale anything to the screen (`k`), same convention as
    // `flagCarriesLayer`/`bombCarrierLayer` (cf. their header).
    const mark = edgeMarkFor(w, view, OFFSCREEN_MARGIN_PX, 1)
    const at = mark ? mark.at : projectTo(view, w)
    // The skull is placed ABOVE the marker (which occupies the point): the offset is applied
    // HERE, the shared glyph only knows its center.
    const center: XY = { x: at.x, y: at.y - SKULL_OFFSET_Y }
    drawSkullGlyph(ctx, center, {
      ink: layer.style.ink,
      outline: layer.style.outline,
      alpha: carriedGlyphAlpha(c.closed, frame, layer.style.reducedMotion),
    })
  }
  ctx.globalAlpha = 1
}
