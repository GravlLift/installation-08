// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * crownGlyph.ts — the SHAPE OF THE VIP CROWN, described ONE single time for its TWO uses: the
 * map glyph (`vipCrownLayer`, canvas) and the card watermark
 * (`ReplayObjectiveMark`, SVG). Same sharing as `skullGlyph.ts`: a shape copied in two
 * places ends up diverging.
 *
 * THE SILHOUETTE, in a 16x16 frame: a BAND separated from the body by a gap, a three-pointed
 * body, and a PEARL on the end of each point. The band and the pearls are what makes it read
 * as a "crown" at small sizes; three bare points read as an M or a hill.
 */
import type { XY } from '../../../lib/replay/replayLogic'

/** Side of the shape's frame. */
export const CROWN_BOX = 16

/** The body: left base, left point, notch, center point, notch, right point, right base. */
const BODY: readonly XY[] = [
  { x: 2.6, y: 11 },
  { x: 1.6, y: 4.8 },
  { x: 5.3, y: 7.9 },
  { x: 8, y: 3.4 },
  { x: 10.7, y: 7.9 },
  { x: 14.4, y: 4.8 },
  { x: 13.4, y: 11 },
]

/** The band, under the body, separated from it by a 0.8 gap. */
const BAND = { x0: 2.6, y0: 11.8, x1: 13.4, y1: 13.8 }

/** The pearls, at the ends of the three points. */
const PEARLS: readonly { c: XY; r: number }[] = [
  { c: { x: 1.6, y: 4.3 }, r: 1.3 },
  { c: { x: 8, y: 2.6 }, r: 1.5 },
  { c: { x: 14.4, y: 4.3 }, r: 1.3 },
]

/** Bottom of the shape in its frame: the caller aligns the top of the player marker there. */
export const CROWN_BOTTOM = BAND.y1

const n = (v: number) => Number(v.toFixed(2))

function pearlSvg({ c, r }: { c: XY; r: number }): string {
  return `M${n(c.x - r)} ${n(c.y)}a${r} ${r} 0 1 1 ${n(2 * r)} 0a${r} ${r} 0 1 1 ${n(-2 * r)} 0Z`
}

/** The SVG path of the crown, in the 16x16 frame (card watermark). */
export const CROWN_SVG_PATH = [
  `M${BODY.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}Z`,
  `M${BAND.x0} ${BAND.y0}H${BAND.x1}V${BAND.y1}H${BAND.x0}Z`,
  ...PEARLS.map(pearlSvg),
].join(' ')

/**
 * traceCrown places the crown path on the context (without painting it), the 16x16 frame
 * placed at `origin` and scaled by a factor `scale`. The caller chooses fill and/or stroke.
 */
export function traceCrown(ctx: CanvasRenderingContext2D, origin: XY, scale: number): void {
  const px = (p: XY): XY => ({ x: origin.x + p.x * scale, y: origin.y + p.y * scale })
  ctx.beginPath()
  BODY.forEach((p, i) => {
    const q = px(p)
    if (i === 0) ctx.moveTo(q.x, q.y)
    else ctx.lineTo(q.x, q.y)
  })
  ctx.closePath()
  const b0 = px({ x: BAND.x0, y: BAND.y0 })
  const b1 = px({ x: BAND.x1, y: BAND.y1 })
  ctx.rect(b0.x, b0.y, b1.x - b0.x, b1.y - b0.y)
  for (const { c, r } of PEARLS) {
    const q = px(c)
    ctx.moveTo(q.x + r * scale, q.y)
    ctx.arc(q.x, q.y, r * scale, 0, Math.PI * 2)
  }
}
