// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * bombGlyph.ts — the GLYPH OF THE ASSAULT BOMB, traced ONE single time for its TWO states
 * (carried above the carrier, placed on the ground), like `skullGlyph.ts` whose stance it
 * borrows.
 *
 * WHY VECTORIAL AND NOT THE GAME THUMBNAIL, and that is a decision, not an oversight. The
 * bomb does have an extracted sprite (`contour-34`, named "ball | bomb" in the atlas index,
 * tags weap `3fee4fcf`/`523b4648`) — but its URL is NOT baked into the replay document, and
 * the client never GUESSES an atlas index: that is the `killfeed-NN` trap documented in the
 * header of `skullGlyph.ts` (an index that moves from one season breaks the join IN
 * SILENCE). The skull had ruled exactly this case on 2026-08-28: canvas glyph holding the
 * role until a Go lot publishes the URL in the document. Two mode objects of the same screen
 * follow the same rule.
 *
 * ITS DRESSING IS THAT OF THE SKULL AND THE FLAG: a RIM in the ink of the BACKGROUND under
 * the silhouette, which gives a sharp edge on a photographic map background, in both themes
 * (inks RESOLVED by the caller — never a hard-coded color, color-tokens rule).
 *
 * THE SHAPE IS THAT OF THE CARD WATERMARK (`ReplayObjectiveMark.tsx`, glyph `bomb`): a round
 * body, a collar, a slanted fuse — and it is the FUSE, not the body, that carries the
 * identification: without it the bomb would be indistinguishable from the skull at this
 * size. The sizes weigh like the skull (r=7) so that the mode objects have the same visual
 * weight.
 */
import type { XY } from '../../../lib/replay/replayLogic'

/** Radius of the body, in canvas pixels. The whole template (body + collar + fuse) weighs ~r=7. */
export const BOMB_GLYPH_RADIUS = 6

/** Overhang of the rim beyond the silhouette — SAME SIZE as the skull and the flag. */
const BOMB_LISERE_PAD = 1.6
/** Width of the rim stroke (centered on the path: only the outer half overhangs). */
const BOMB_LISERE_WIDTH = 2 * BOMB_LISERE_PAD

/** The collar, placed on the body: half width and vertical bounds (frame center of the body). */
const BOMB_NECK_HALF_W = 1.9
const BOMB_NECK_TOP = -8.4
const BOMB_NECK_BOTTOM = -4.6

/** The fuse: from the top of the collar toward the upper right, in a slight arc. */
const BOMB_FUSE_X0 = 0.6
const BOMB_FUSE_Y0 = -8.2
const BOMB_FUSE_CTRL_X = 2.8
const BOMB_FUSE_CTRL_Y = -10.6
const BOMB_FUSE_X1 = 4.4
const BOMB_FUSE_Y1 = -10.2
const BOMB_FUSE_WIDTH = 1.5

/** What the tracing of a bomb needs to know (5-parameter rule). */
export interface BombGlyphPaint {
  /** Ink of the silhouette: the neutral of the theme, resolved by the caller. */
  ink: string
  /** Ink of the BACKGROUND: the rim placed UNDER the silhouette (`markInk.outline`). */
  outline: string
  alpha: number
}

/** Traces the silhouette (body + collar) on the current path of the context. */
function bombSilhouette(ctx: CanvasRenderingContext2D, c: XY): void {
  ctx.beginPath()
  ctx.arc(c.x, c.y, BOMB_GLYPH_RADIUS, 0, Math.PI * 2)
  ctx.rect(
    c.x - BOMB_NECK_HALF_W,
    c.y + BOMB_NECK_TOP,
    2 * BOMB_NECK_HALF_W,
    BOMB_NECK_BOTTOM - BOMB_NECK_TOP,
  )
}

/** Traces the fuse on the current path of the context. */
function bombFuse(ctx: CanvasRenderingContext2D, c: XY): void {
  ctx.beginPath()
  ctx.moveTo(c.x + BOMB_FUSE_X0, c.y + BOMB_FUSE_Y0)
  ctx.quadraticCurveTo(
    c.x + BOMB_FUSE_CTRL_X,
    c.y + BOMB_FUSE_CTRL_Y,
    c.x + BOMB_FUSE_X1,
    c.y + BOMB_FUSE_Y1,
  )
}

/**
 * drawBombGlyph places the bomb at `center`: rim in the ink of the background under the whole
 * silhouette (fuse included), fill in the neutral ink on top — the sharp edge technique of
 * the flag and the skull.
 *
 * THE POINT SERVED IS THE CENTER OF THE BODY, never an offset point: the caller applies their
 * own offset (above the marker of the carrier, or on the last point of the ground dropper).
 */
export function drawBombGlyph(ctx: CanvasRenderingContext2D, center: XY, paint: BombGlyphPaint): void {
  ctx.globalAlpha = paint.alpha
  // THE RIM FIRST: silhouette and fuse in the ink of the background, in a wide stroke.
  ctx.strokeStyle = paint.outline
  ctx.lineWidth = BOMB_LISERE_WIDTH
  ctx.lineCap = 'round'
  bombSilhouette(ctx, center)
  ctx.stroke()
  bombFuse(ctx, center)
  ctx.lineWidth = BOMB_FUSE_WIDTH + BOMB_LISERE_WIDTH
  ctx.stroke()
  // THE SILHOUETTE, in the neutral ink: it covers the inner half of the rim.
  ctx.fillStyle = paint.ink
  bombSilhouette(ctx, center)
  ctx.fill()
  // THE FUSE, in the neutral ink on its rim.
  ctx.strokeStyle = paint.ink
  ctx.lineWidth = BOMB_FUSE_WIDTH
  bombFuse(ctx, center)
  ctx.stroke()
}
