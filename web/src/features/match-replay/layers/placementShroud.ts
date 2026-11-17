// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * placementShroud — THE BUBBLE of the blackout screen (shroud screen): its range, its fold
 * duration, and its shape on the map.
 *
 * WHY A FILE APART. The bubble gained two inks and sparkling bolts: like the rift
 * (`placementRift.ts`) and the wall (`placementWall.ts`), it comes out of
 * `placementShapes.ts` to keep the latter under the 500-line threshold.
 *
 * Like the rest of the folder: no React, no written color. The inks come from the calling
 * layer, which holds them from the theme tokens (`useReplayInks`).
 */
import type { XY } from '../../../lib/replay/replayLogic'
import type { ShapeStyle } from './placementShapes'

/**
 * Radius of the blackout screen, in world meters. DECLARED VALUE, NOT MEASURED, NOT
 * OFFICIAL — same status as that of the repair field, and it needs to be said just as
 * plainly.
 *
 * THE THREE SOURCES ARE EMPTY, AND THAT IS THE REASON FOR THE EXISTENCE OF THE BLURRED
 * EDGE. The film carries no range for this object; the official source that figures the
 * detector (4.25 m) does not figure this screen; and nothing was measured in the corpus.
 * 6 m — 12 m in diameter — is a SCREEN choice, calibrated on what the bubble of the game
 * covers in practice (a corridor, a narrow passage), and deliberately TWICE the repair
 * field so that the three disks of the layer (sensor 4.25 m, field 3 m, screen 6 m) are
 * never confused.
 *
 * THE BLURRED EDGE CARRIES THIS RESERVE TO THE SCREEN, as the dotted line does for the
 * field. Two different conventions for the same reserve, and that is intended: the field
 * has a BOUND one doubts (a ring, in dotted), the screen has no bound at all (a gradient,
 * no ring). A sharp limit would say "beyond this stroke one sees", which no one
 * established.
 */
export const SHROUD_RADIUS_M = 6

/**
 * THE FOLD DURATION OF THE BLACKOUT SCREEN, in ms: 7.5 s, READ IN THE FILM. At the impact,
 * the film makes an object that the i28 stack does not name be born and removes it 7.51 s
 * later (38 screens out of 39, five films from 2025-11 to 2026-07), duration confirmed in
 * game by the user. Since schema 106 the document carries this object (`tracked[].effect`):
 * its birth and removal READ bound the placement (`spawnedObjects.ts`). This duration
 * serves only an screen whose bubble is not read (earlier artifact, ambiguous association,
 * non-read removal). The `t1` of the generated object, for its part, is the end of the
 * GRENADE (0.1 to 0.4 s after the placement). The window of the placement
 * (`placementWindow.ts`) reads this duration at this place and nowhere else.
 */
export const SHROUD_DURATION_MS = 7_500

/**
 * The inks of the bubble, the game's own (`shroudInk.ts`): the blue of its body (`core`), the
 * cyan-white of its rim (`glow`, also the 2D edge and bolts), and the light blue of the 3D
 * bubble's hexagonal cell borders (`cell`).
 */
export interface ShroudInk {
  core: string
  glow: string
  cell: string
}

/** Part of the radius occupied by the edge fade (verdict R2-6: 22%). */
const SHROUD_FADE_RATIO = 0.22
/** Opacity of the core. Almost full: the verdict of 2026-08-27 is "opaque". */
const SHROUD_CORE_ALPHA = 0.94
/** Where, in the fade, the electric ink peaks before dying out. */
const SHROUD_GLOW_STOP = 0.45

/**
 * THE SPARKLE OF THE BOLTS — the SAME curve as those of the card (`@keyframes
 * replay-zone-bolt`, globals.css): a brief double beat in a 2.6 s cycle. The two copies
 * (CSS for the card, canvas here) must remain identical, otherwise the map and the card of
 * a player in the bubble would no longer beat together.
 */
const SHROUD_BOLT_CYCLE_MS = 2_600
const SHROUD_BOLT_KEYS: readonly (readonly [number, number])[] = [
  [0, 0], [0.06, 0], [0.08, 0.95], [0.11, 0.15], [0.14, 0.8], [0.22, 0], [1, 0],
]

/**
 * Offset of each bolt in the cycle, in seconds — shared with the card
 * (`ReplayPlayerCard.SHROUD_BOLTS`), so that the bolts of the map and those of the card
 * light up at the same instant.
 */
export const SHROUD_BOLT_OFFSETS_S = [0, 1.3, 2.05] as const

/**
 * The geometry of the bolts, in fractions of the full radius: abscissa of the tracing and
 * top-to-bottom zigzag. They stay INSIDE the core — a bolt that would overhang would draw
 * the bound the fade refuses to place.
 */
const SHROUD_BOLT_X = [-0.38, 0.3, -0.02] as const
const SHROUD_BOLT_PATH: readonly XY[] = [
  { x: 0.1, y: -0.62 }, { x: -0.12, y: -0.04 }, { x: 0.06, y: -0.04 }, { x: -0.1, y: 0.62 },
]
const SHROUD_BOLT_WIDTH = 1.6
const SHROUD_BOLT_BLUR = 6

/**
 * shroudBoltAlpha — the opacity of a bolt `ageMs` after the placement, offset by `offsetS`
 * in the cycle. The clock is that of the PLACEMENT, as on the card: after a reading jump,
 * each bolt resumes at its real progress, never on an invented rhythm.
 */
export function shroudBoltAlpha(ageMs: number, offsetS: number): number {
  const t = (ageMs + offsetS * 1000) / SHROUD_BOLT_CYCLE_MS
  const phase = t - Math.floor(t)
  for (let i = 1; i < SHROUD_BOLT_KEYS.length; i++) {
    const [p1, a1] = SHROUD_BOLT_KEYS[i]
    if (phase > p1) continue
    const [p0, a0] = SHROUD_BOLT_KEYS[i - 1]
    return a0 + ((a1 - a0) * (phase - p0)) / (p1 - p0)
  }
  return 0
}

/** The bubble to draw: its projected center, its radius in pixels, its age since the
 * placement. */
export interface ShroudShape {
  c: XY
  radiusPx: number
  ageMs: number
}

/**
 * drawShroud — THE BUBBLE of the blackout screen.
 *
 * OPAQUE, AND THE PAWNS ON TOP (user verdict of 2026-08-27, among three proposals placed
 * side by side on the board). The opacity says "here, we do not see each other" — that is
 * the very function of the object; the pawns pass on top without a line of code here,
 * because the layer of placements is traced BEFORE that of the tracks.
 *
 * NIGHT BLUE, ELECTRIC EDGE, BOLTS (user decision of 2026-10-30, which replaces the neutral
 * ink): the bubble takes back the blue electricity of the object of the game, already
 * carried by the card of a player who is there. The bolts are a SIGN, not a measurement:
 * nothing in the film beats to this rhythm, hence their cycle borrowed from the card.
 * Under reduced motion they remain off, as on the card: the disk already says the state
 * without blinking.
 */
export function drawShroud(
  ctx: CanvasRenderingContext2D,
  shape: ShroudShape,
  style: ShapeStyle,
  ink: ShroudInk,
): void {
  const { c, radiusPx } = shape
  if (!(radiusPx > 0)) return
  const plein = radiusPx * (1 - SHROUD_FADE_RATIO)
  ctx.save()
  ctx.fillStyle = ink.core
  ctx.globalAlpha = SHROUD_CORE_ALPHA
  ctx.beginPath()
  ctx.arc(c.x, c.y, plein, 0, Math.PI * 2)
  ctx.fill()
  // The fade: from the core, by the electric ink, to nothingness — without ever placing a
  // stroke. It is the ABSENCE of a ring that says the range is not known.
  const g = ctx.createRadialGradient(c.x, c.y, plein, c.x, c.y, radiusPx)
  g.addColorStop(0, ink.core)
  g.addColorStop(SHROUD_GLOW_STOP, ink.glow)
  g.addColorStop(1, 'transparent')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(c.x, c.y, radiusPx, 0, Math.PI * 2)
  ctx.fill()
  if (!style.reducedMotion) drawShroudBolts(ctx, { ...shape, radiusPx: plein }, style, ink.glow)
  ctx.restore()
}

/** drawShroudBolts — the bolts lit at this instant; nothing between two beats. */
function drawShroudBolts(
  ctx: CanvasRenderingContext2D,
  shape: ShroudShape,
  style: ShapeStyle,
  color: string,
): void {
  const { c, radiusPx: r, ageMs } = shape
  ctx.strokeStyle = color
  ctx.shadowColor = color
  ctx.shadowBlur = SHROUD_BOLT_BLUR * style.k
  ctx.lineWidth = SHROUD_BOLT_WIDTH * style.k
  ctx.lineJoin = 'miter'
  SHROUD_BOLT_OFFSETS_S.forEach((offsetS, i) => {
    const alpha = shroudBoltAlpha(ageMs, offsetS)
    if (!(alpha > 0)) return
    const x0 = c.x + SHROUD_BOLT_X[i] * r
    ctx.globalAlpha = alpha
    ctx.beginPath()
    SHROUD_BOLT_PATH.forEach((p, j) => {
      if (j === 0) ctx.moveTo(x0 + p.x * r, c.y + p.y * r)
      else ctx.lineTo(x0 + p.x * r, c.y + p.y * r)
    })
    ctx.stroke()
  })
}
