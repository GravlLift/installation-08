// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * vipCrownLayer.ts — THE VIP CROWN (schema 22), frame by frame.
 *
 * WHY IT LIVES BESIDE THE OTHER STATE LAYERS. Same sharing as `flagCarriesLayer.ts`: the
 * marker follows its carrier frame by frame (the VIP runs, the period only publishes an
 * interval), so it is painted AT EVERY FRAME, on the RE-READ position of the player — never
 * at a frozen position.
 *
 * WHAT THE CROWN SAYS, AND NOTHING MORE: WHO carries the VIP crown at this frame. A period
 * opens at the selection of the VIP and closes at their death (or at the next selection).
 * Two sides each have their VIP: two crowns can therefore be on screen at the same time,
 * and that is right.
 *
 * `closed` false = NOTHING dates the end of the carry: the interval runs to the end of the
 * axis, an UPPER BOUND. The crown is then FAINT — the uncertainty is on screen, not in a
 * note.
 *
 * THE INK IS THAT OF THE SIDE OF THE VIP, seen from the looked-at player (ally / enemy),
 * like the flag: with two VIPs on screen, the color says which one is to protect and which
 * one is to take down. Without known allegiance, the neutral of the theme — never a
 * supposed side. The ink is RESOLVED by the caller (color-tokens rule). The glyph places a
 * RIM in the ink of the background, at the same dimension as the flag and the skull, to
 * keep a sharp edge on a busy map background.
 *
 * NO GAME THUMBNAIL: the film does not carry the VIP bit (the lane is the statborg), there
 * is therefore no tag nor image to guess. The shape is described in `crownGlyph.ts`,
 * shared with the watermark of the card. No text: the crown sits ON the player already
 * named by their marker, ABOVE them — it qualifies them, it does not replace them.
 *
 * THE CARRIER IS RE-READ IN THEIR TRAJECTORIES (`posOf`), like the flag: without position,
 * the crown does not draw — it has no position of its own (it is ALWAYS on the player).
 */
import { type XY } from '../../../lib/replay/replayLogic'

import { type CanvasView, projectTo } from '../model/replayView'
import type { ReplayVipPeriod } from '../../../lib/replay/replayNormalize'
import { carriedGlyphAlpha } from './carriedGlyphPulse'
import { covers } from '../model/replaySpans'
import { CROWN_BOTTOM, CROWN_BOX, traceCrown } from './crownGlyph'

/** Style of the layer: the inks are RESOLVED by the caller (color-tokens rule). */
export interface VipCrownStyle {
  /** Ink of the crown of a VIP: the color of their side seen from the looked-at player, or
   * the neutral. */
  inkOf: (xuid: string) => string
  /** Ink of the BACKGROUND, for the rim (that of the flag and the skull). */
  outline: string
  /** Reduced motion: the pulsation of the "open" crown becomes a constant opacity. */
  reducedMotion: boolean
}

/**
 * VipCrownInput — what the layer receives from the caller (`useReplayVipCrown`).
 *
 * `posOf` is THE reason for this field: the crown draws on the marker of the VIP at the
 * current frame. The layer does not know how to re-read a trajectory — the caller passes
 * it the reading.
 */
export interface VipCrownInput {
  style: VipCrownStyle
  /** World position of the player at a frame, or `null` if they are not locatable. */
  posOf: (xuid: string, frame: number) => XY | null
}

/** Side of the glyph, in canvas pixels: the width of the carried skull (r=7 + rim). */
export const CROWN_SIZE_PX = 18
/**
 * Height of the bottom of the crown above the point of the player: the bottom of the
 * carried skull (center at 12, radius 7), so that the carried objects hold the same place
 * above the marker.
 */
const CROWN_FOOT_Y = 5
/** Overhang of the rim beyond the shape — SAME DIMENSION as the flag (`FLAG_OUTLINE_PAD`). */
const CROWN_LISERE_PAD = 1.6

/**
 * vipActiveAt returns the periods that COVER the requested frame — at most one per current
 * VIP, but several sides can each have their own. PURE FUNCTION, tested apart.
 */
export function vipActiveAt(
  periods: readonly ReplayVipPeriod[],
  frame: number,
): ReplayVipPeriod[] {
  const out: ReplayVipPeriod[] = []
  for (const p of periods) {
    if (covers(p, frame)) out.push(p)
  }
  return out
}

/**
 * drawVipCrown paints, ON TOP of the markers, the crown on the current VIP of each side.
 *
 * A non-locatable VIP (unpublished life, frame outside their trajectories) is NOT drawn:
 * the crown has no position of its own, and inventing one would assert a place that the
 * film does not give at this frame.
 */
export function drawVipCrown(
  ctx: CanvasRenderingContext2D,
  layer: VipCrownInput,
  periods: readonly ReplayVipPeriod[],
  view: CanvasView,
  frame: number,
): void {
  for (const p of vipActiveAt(periods, frame)) {
    const w = layer.posOf(p.xuid, frame)
    if (!w) continue
    drawCrownGlyph(ctx, projectTo(view, w), {
      ink: layer.style.inkOf(p.xuid),
      outline: layer.style.outline,
      alpha: carriedGlyphAlpha(p.closed, frame, layer.style.reducedMotion),
    })
  }
  ctx.globalAlpha = 1
}

/** What the tracing of a glyph needs to know. */
interface CrownGlyphPaint {
  ink: string
  outline: string
  alpha: number
}

/**
 * drawCrownGlyph traces the crown ABOVE the point served: the rim in the ink of the
 * background first (centered stroke, of which the fill covers the inner half), then the
 * shape in the ink of the side.
 */
export function drawCrownGlyph(
  ctx: CanvasRenderingContext2D,
  at: XY,
  paint: CrownGlyphPaint,
): void {
  const scale = CROWN_SIZE_PX / CROWN_BOX
  const origin: XY = {
    x: at.x - CROWN_SIZE_PX / 2,
    y: at.y - CROWN_FOOT_Y - CROWN_BOTTOM * scale,
  }
  ctx.globalAlpha = paint.alpha
  traceCrown(ctx, origin, scale)
  ctx.lineJoin = 'round'
  ctx.lineWidth = 2 * CROWN_LISERE_PAD
  ctx.strokeStyle = paint.outline
  ctx.stroke()
  ctx.fillStyle = paint.ink
  ctx.fill()
}
