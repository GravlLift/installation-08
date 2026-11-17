// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * bombCarrierLayer.ts — the ASSAULT BOMB (schema 30), frame by frame: on its CARRIER during
 * the carry periods, ON THE GROUND between a drop and the next pickup.
 *
 * WHY IT LIVES BESIDE `skullCarrierLayer`. Same sharing: the marker follows its carrier
 * frame by frame (the carrier runs, the period only publishes an interval), so it is painted
 * AT EVERY FRAME, on the RE-READ position of the player — never at a frozen position.
 *
 * THE BOMB ON THE GROUND IS DERIVED, NOT PUBLISHED, and that is written on both sides (cf.
 * document_bomb_carries.go): the bomb object has no measured channel on the Go side. Between
 * the END of a CLOSED period and the next pickup, the bomb is immobile at the LAST POINT of
 * its dropper — the `dropped` rule of the flag, the position coming here from the already
 * published track of the dropper at the instant of the drop. The segment is cut at the first
 * of: the next pickup, the EXPLOSION (`bomb_detonations` of the actions layer — after it,
 * the bomb no longer exists), the end of the axis. WITHOUT A TRUSTED CLOCK
 * (`filmClockTrusted` false), the explosions are not placed on the grid: the ground is NOT
 * drawn (the caller passes `explosions: null`) — a placed bomb that would survive its own
 * explosion would assert what the film does not say; silent is worth better than wrong, the
 * rule of the whole chain.
 *
 * `closed` false = NOTHING dates the end of the carry (the film stops during it): the carried
 * glyph PULSES, like the skull — the uncertainty is on the screen, not in a note. An open
 * carry NEVER produces a ground bomb: no one dropped it.
 *
 * The glyph is SINGLE (`bombGlyph.ts`) for the two states — one recognizes the same object;
 * only its place changes, exactly like the free skull and the carried skull.
 */
import { drawBombGlyph } from './bombGlyph'
import { type XY } from '../../../lib/replay/replayLogic'

import { type CanvasView, projectTo } from '../model/replayView'
import { edgeMarkFor, OFFSCREEN_MARGIN_PX } from '../model/edgeClamp'
import type { ReplayBombCarry } from '../../../lib/replay/replayNormalize'
import { carriedGlyphAlpha } from './carriedGlyphPulse'
import { carriedGlyphPlaceAt } from '../model/carriedGlyphPlace'
import { covers } from '../model/replaySpans'

/** Style of the layer: the inks are RESOLVED by the caller (color-tokens rule). */
export interface BombCarrierStyle {
  /** Ink of the bomb (token of the theme already resolved by the caller). */
  ink: string
  /** Ink of the BACKGROUND: the rim, like that of the skull and the flag. */
  outline: string
  /** Reduced motion: the pulsation of an "open" carry becomes a constant opacity. */
  reducedMotion: boolean
}

/**
 * BombCarrierInput — what the layer receives from the caller (`useReplayBombCarrier`).
 *
 * `posOf` is the REASON FOR THE FIELD: the bomb is drawn on the marker of its carrier at the
 * current frame, and ON THE GROUND at the last point of its dropper. The layer does not know
 * how to re-read a trajectory — the caller passes it the reading.
 */
export interface BombCarrierInput {
  style: BombCarrierStyle
  /** World position of the player at a frame, or `null` if they are not locatable. */
  posOf: (xuid: string, frame: number) => XY | null
}

/** Vertical offset above the point of the carrier (the marker occupies the point itself). */
const BOMB_OFFSET_Y = 12

/**
 * Opacity of the bomb ON THE GROUND: slightly under the carried one, because the position is
 * DERIVED (last point of the dropper) and not published — the nuance states the nature of
 * the data without making it disappear.
 */
const ALPHA_GROUND = 0.85

/**
 * bombCarrierActiveAt returns the carries that COVER the requested frame. ONLY ONE bomb: at
 * most one, but we return a list (like the sibling layers) for a uniform tracing. Pure.
 */
export function bombCarrierActiveAt(
  carries: readonly ReplayBombCarry[],
  frame: number,
): ReplayBombCarry[] {
  const out: ReplayBombCarry[] = []
  for (const c of carries) {
    if (covers(c, frame)) out.push(c)
  }
  return out
}

/**
 * bombGroundAt returns the CLOSED period whose drop puts the bomb on the ground at this
 * frame, or `null`: no one carries it, the last closed period is at t1 < frame, no following
 * period has started, and no explosion fell in ]t1, frame].
 *
 * `explosions`: the frames of the `bomb_detonations`, sorted — `null` when the clock of the
 * film is not trusted: the ground is not drawn (cf. the header). Pure, tested apart.
 */
export function bombGroundAt(
  carries: readonly ReplayBombCarry[],
  explosions: readonly number[] | null,
  frame: number,
): ReplayBombCarry | null {
  if (explosions === null) return null
  let last: ReplayBombCarry | null = null
  for (const c of carries) {
    if (covers(c, frame)) return null // carried: never on the ground at the same time
    if (c.t1 < frame && c.closed && (last === null || c.t1 > last.t1)) last = c
  }
  if (last === null) return null
  for (const e of explosions) {
    if (e > last.t1 && e <= frame) return null // the bomb went off: it no longer exists
  }
  return last
}

/**
 * drawBombCarrier paints the bomb of the frame: on its current carrier (on top of the
 * marker), or on the ground at the last point of its dropper.
 *
 * CARRIER WITHOUT POSITION (audit of 2026-09-10, cause C10; lot 6.7 phase B2): the bomb no
 * longer DISAPPEARS. The carry is true, it is the trajectory of the biped that has a hole —
 * the rule shared by the three carried glyphs (`carriedGlyphPlace.ts`) makes it FREE at its
 * last known position, with the dressing of the ground. WITHOUT ANY known position since the
 * start of the carry, nothing is drawn: the bomb has no position channel of its own, and
 * inventing one would assert a place that the film does not give.
 *
 * OFF-SCREEN BOUNDING (off-screen squad plan, workstream B, decision D3, 2026-09-10): ONLY
 * the CARRIED bomb (on its carrier) is clamped to the margin when it leaves the visible
 * framing — on the ground, it is an object of the map, like a weapon pedestal, outside the
 * scope ruled for this lot.
 */
export function drawBombCarrier(
  ctx: CanvasRenderingContext2D,
  layer: BombCarrierInput,
  carries: readonly ReplayBombCarry[],
  explosions: readonly number[] | null,
  view: CanvasView,
  frame: number,
): void {
  for (const c of bombCarrierActiveAt(carries, frame)) {
    // THE RULE SHARED BY THE THREE CARRIED GLYPHS (`carriedGlyphPlace.ts`): without a
    // position of the carrier, the bomb is FREE at its last known position, not
    // disappeared. `fallback: null` — the bomb has NO position channel of its own (cf. the
    // header, document_bomb_carries.go).
    const place = carriedGlyphPlaceAt(layer.posOf, c, frame, null)
    if (place.state === 'absent') continue
    if (place.state === 'free') {
      // FREE: anchored on the point itself, without the offset of the carried one (no pawn
      // to avoid), and without off-screen bounding — it has become an object of the map,
      // like the ground bomb.
      drawBombGlyph(ctx, projectTo(view, place.at), {
        ink: layer.style.ink,
        outline: layer.style.outline,
        alpha: ALPHA_GROUND,
      })
      ctx.globalAlpha = 1
      return // only one bomb: a single glyph at this frame
    }
    // SCALE 1: this layer does not yet scale anything to the screen (`k`), same convention
    // as `flagCarriesLayer`/`skullCarrierLayer` (cf. their header).
    const mark = edgeMarkFor(place.at, view, OFFSCREEN_MARGIN_PX, 1)
    const at = mark ? mark.at : projectTo(view, place.at)
    // The bomb is placed ABOVE the marker (it occupies the point): the offset is applied
    // HERE, the shared glyph only knows its center.
    drawBombGlyph(ctx, { x: at.x, y: at.y - BOMB_OFFSET_Y }, {
      ink: layer.style.ink,
      outline: layer.style.outline,
      alpha: carriedGlyphAlpha(c.closed, frame, layer.style.reducedMotion),
    })
    ctx.globalAlpha = 1
    return // only one bomb: carried, hence never on the ground at the same frame
  }
  const ground = bombGroundAt(carries, explosions, frame)
  if (ground) {
    // ON THE GROUND: at the last point of the dropper, at the INSTANT of the drop (t1) —
    // the position is not re-read at the current frame, the bomb does not follow a player
    // who no longer carries it.
    const w = layer.posOf(ground.xuid, ground.t1)
    if (w) {
      const at = projectTo(view, w)
      drawBombGlyph(ctx, at, {
        ink: layer.style.ink,
        outline: layer.style.outline,
        alpha: ALPHA_GROUND,
      })
    }
  }
  ctx.globalAlpha = 1
}
