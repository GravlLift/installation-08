// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldBarGeometry.ts — pure geometry of the first-person shield bar, in a 1000 × 74 box.
 *
 * The bar's edges sag toward the center and its ends are chamfered to a point below the middle
 * (read off the 1280x720 and 1920x1080 in-game captures). `ShieldBar3d.tsx` traces the same
 * shape in SVG and the video export traces it on a canvas; both read their numbers here.
 */

export const SHIELD_BAR_W = 1000
export const SHIELD_BAR_H = 74
/** The fill clip's center: the bar is symmetric about x 500, the fill drains from both ends. */
export const SHIELD_CENTER = 500

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
