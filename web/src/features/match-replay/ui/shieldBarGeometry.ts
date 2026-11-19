// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldBarGeometry.ts — pure geometry of the first-person shield bar, in a 1000 × 74 box.
 *
 * The bar's edges sag toward the center and its ends are chamfered to a point below the middle
 * (read off the 1280x720 and 1920x1080 in-game captures). `ShieldBar3d.tsx` traces the same
 * shape in SVG and the video export traces it on a canvas; both read their numbers here. The
 * game's own quad (`SHIELD_QUAD_*`) carries the bar's shape in the game's 940x80 units when the
 * quad bitmap is loaded, in place of the hand-made 1000x74 shape.
 */

export const SHIELD_BAR_W = 1000
export const SHIELD_BAR_H = 74
/** The fill clip's center: the bar is symmetric about x 500, the fill drains from both ends. */
export const SHIELD_CENTER = 500

/**
 * The game's own quad (`SHIELD_QUAD_URL`), a 940x80 bitmap whose alpha is the bar's shape: the
 * numbers below are the bar's shape in the game's own units, as `ShieldBar3d.tsx` uses them in
 * quad mode and the video export paints them on a canvas.
 */
export const SHIELD_QUAD_W = 940
export const SHIELD_QUAD_H = 80
/** The fill clip's center in quad units: the fill drains from both ends toward it. */
export const SHIELD_QUAD_CENTER = 470
/** The half-width in quad units: a full shield spans the whole quad. */
export const SHIELD_QUAD_HALF = 470
/** The chase bitmap's own height in quad units (the bitmap is quad-width). */
export const SHIELD_QUAD_CHASE_H = 64
// INFERRED: where the 64-tall chase sits vertically in the 80-tall quad. The screen dump does not
// settle a clean nested offset (both quads render at the same 40-unit height from bitmaps of
// different native heights, the main quad's margin_top -8 vs the chase's 0), so it is centered.
export const SHIELD_QUAD_CHASE_Y = (SHIELD_QUAD_H - SHIELD_QUAD_CHASE_H) / 2
// The quad's alpha is the outline at full strength and the hex cells at only 20 to 50 %, made
// for the game's additive HDR draw; used raw as the bar's shape it leaves the fill see-through
// and the bar reads white. NOT IN THE GAME'S DATA (set by eye in the viewer): the shape is the
// alpha times SHIELD_QUAD_SHAPE_GAIN (clamped), so the cells become the bar's solid inside and
// the glow outside the outline stays faint; the raw alpha is then drawn in white at
// SHIELD_QUAD_HEX_OPACITY over the fill, for the hex pattern and the outline.
export const SHIELD_QUAD_SHAPE_GAIN = 4
export const SHIELD_QUAD_HEX_OPACITY = 0.18
// The fill's opacity in quad mode (the legacy bar's 0.82 let the dark track through; on the
// quad's solid shape that read gray-white). Set by eye.
export const SHIELD_QUAD_FILL_OPACITY = 1

/** The minimal path interface the bar's tracers need (satisfied by `CanvasRenderingContext2D`). */
export interface ShieldBarPath {
  moveTo(x: number, y: number): void
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void
  lineTo(x: number, y: number): void
  closePath(): void
}

/** Trace the bar outline into a 2D context (canvas 2D or any `ShieldBarPath`). */
export function traceShieldBar(path: ShieldBarPath): void {
  path.moveTo(20, 6)
  path.quadraticCurveTo(500, 34, 980, 6)
  path.lineTo(1000, 40)
  path.lineTo(988, 56)
  path.quadraticCurveTo(500, 86, 12, 56)
  path.lineTo(0, 40)
  path.closePath()
}

/** The gloss line under the top edge. */
export function traceShieldGloss(path: ShieldBarPath): void {
  path.moveTo(24, 11)
  path.quadraticCurveTo(500, 39, 976, 11)
}

/** The two faint light streaks lower down. */
export function traceShieldStreak(path: ShieldBarPath, index: 0 | 1): void {
  path.moveTo(0, index === 0 ? 30 : 44)
  path.quadraticCurveTo(500, index === 0 ? 58 : 72, 1000, index === 0 ? 30 : 44)
}

/** The SVG path string for the bar outline. */
export function shieldBarPath(): string {
  return 'M20 6 Q500 34 980 6 L1000 40 L988 56 Q500 86 12 56 L0 40 Z'
}

/** The SVG path string for the gloss line. */
export function shieldGlossPath(): string {
  return 'M24 11 Q500 39 976 11'
}

/** The SVG path strings for the two streaks. */
export function shieldStreakPaths(): [string, string] {
  return ['M0 30 Q500 58 1000 30', 'M0 44 Q500 72 1000 44']
}
