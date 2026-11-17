// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * offscreenChevron.ts — THE OFF-SCREEN ARROW (off-screen squad plan, workstream B, decision
 * D2, template provided by the user: `Pictures/Screenpresso/2026-09-09_14h26_04.png`).
 *
 * WHAT THIS FILE DRAWS, AND NOTHING MORE: the glyph placed by `edgeMarkFor` (`model/
 * edgeClamp.ts`) — a SOLID ARROW WITH A CONCAVE BASE, rotated toward the real position, and
 * the "name · distance" label that accompanies it. The clamping geometry (where, at what
 * angle, at what distance) lives in `edgeClamp.ts`; this module ONLY paints what it computed —
 * the same split as `edgeClamp.ts` / the tracing layers everywhere else in the replay.
 *
 * THE TEMPLATE IS NORMALIZED, POINTING +X: `ctx.rotate` does the rest. Four vertices close
 * the path — tip, back-left, NOTCH (the hollow that makes the base concave, not a solid
 * triangle), back-right — exactly the coordinates of the template validated by the user.
 * `ctx.scale` brings the template to its SCREEN size: `CHEVRON_SIZE_PX * k`, never a canvas
 * factor — the same convention as everything addressed to the eye in this feature (cf. the
 * header of `replayMarkers.ts`).
 *
 * THE LABEL IS PLACED ON THE INNER SIDE OF THE ARROW, opposite `angle`: the arrow points at a
 * position that is OFF CANVAS, placing the text in its extension would push it out of the
 * visible frame. It borrows the same readability technique as `replayLabels.ts` (a stroke
 * then a fill), with an INK resolved by the caller — never a literal, never `readInk` called
 * from here (cf. `canvasInk.ts`, the color-tokens rule).
 */
import type { XY } from '../../../lib/replay/replayLogic'

/**
 * The normalized template, pointing +X — four vertices, in the ORDER `ctx.lineTo` traces them:
 * tip, back-left, notch (the central hollow, CONCAVE base), back-right. These are the exact
 * coordinates of the template provided by the user (decision D2), at scale 1.
 */
const TIP: XY = { x: 1, y: 0 }
const BACK_LEFT: XY = { x: -0.75, y: -0.7 }
const NOTCH: XY = { x: -0.35, y: 0 }
const BACK_RIGHT: XY = { x: -0.75, y: 0.7 }

/** Template size, in REFERENCE SCREEN pixels (before scaling by `k`). */
export const CHEVRON_SIZE_PX = 12

/**
 * drawOffscreenChevron paints the template at `at`, rotated by `angle` (radians, canvas
 * space), scaled to the screen by `k`, filled with `color`.
 *
 * `save`/`restore` frame the gesture: `translate`/`rotate`/`scale` must leak to no following
 * layer (same rule as `drawRotatedSprite`, `replayDraw.ts`).
 */
export function drawOffscreenChevron(
  ctx: CanvasRenderingContext2D,
  at: XY,
  angle: number,
  k: number,
  color: string,
): void {
  ctx.save()
  ctx.translate(at.x, at.y)
  ctx.rotate(angle)
  ctx.scale(CHEVRON_SIZE_PX * k, CHEVRON_SIZE_PX * k)
  ctx.beginPath()
  ctx.moveTo(TIP.x, TIP.y)
  ctx.lineTo(BACK_LEFT.x, BACK_LEFT.y)
  ctx.lineTo(NOTCH.x, NOTCH.y)
  ctx.lineTo(BACK_RIGHT.x, BACK_RIGHT.y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  ctx.restore()
}

/** Gap between the mark and the label anchor, in REFERENCE SCREEN pixels. */
const LABEL_GAP_PX = 14
/** Font body, in SCREEN pixels — same body as `replayLabels.ts`. */
const LABEL_FONT_PX = 8.5
const LABEL_WEIGHT = 600
const LABEL_STROKE_PX = 2.6

/**
 * offscreenLabelAnchor returns the point where the label goes: at `LABEL_GAP_PX * k` from
 * `at`, in the direction OPPOSITE to `angle` — the INNER side of the arrow, the one that
 * stays on the canvas. PURE function, tested apart from its tracing.
 */
export function offscreenLabelAnchor(at: XY, angle: number, k: number): XY {
  const gap = LABEL_GAP_PX * k
  return { x: at.x - Math.cos(angle) * gap, y: at.y - Math.sin(angle) * gap }
}

/** What the label tracing borrows from the caller: the screen density, and the stroke. */
export interface OffscreenLabelStyle {
  /** Canvas density: everything addressed to the eye is multiplied by this factor. */
  k: number
  /** Readability stroke ink. Empty = the theme does not carry the variable: no stroke. */
  labelStroke: string
}

/**
 * drawOffscreenLabel writes `text` (already composed by the caller — "name · distance", or
 * any other label) centered on `offscreenLabelAnchor`, in double stroke (stroke then fill) —
 * the same technique as `replayLabels.ts`, an accepted second copy (3-copy rule, CLAUDE.md
 * n° 6): the position differs (anchored on a directional point, not under a marker), a
 * third occurrence would centralize the two.
 */
export function drawOffscreenLabel(
  ctx: CanvasRenderingContext2D,
  at: XY,
  angle: number,
  text: string,
  style: OffscreenLabelStyle,
  color: string,
): void {
  const k = style.k
  const anchor = offscreenLabelAnchor(at, angle, k)
  ctx.font = `${LABEL_WEIGHT} ${LABEL_FONT_PX * k}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.globalAlpha = 1
  if (style.labelStroke) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = LABEL_STROKE_PX * k
    ctx.strokeStyle = style.labelStroke
    ctx.strokeText(text, anchor.x, anchor.y)
  }
  ctx.fillStyle = color
  ctx.fillText(text, anchor.x, anchor.y)
}
