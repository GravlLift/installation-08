// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * scrubMath — the pure position/frame math of the player's scrub bar. No React and no DOM
 * math here beyond what a test can feed: a position is a fraction of the bar in [0, 1], a
 * frame is an integer index in [0, frameCount - 1].
 */

/** Clamps `value` into [0, 1]. */
export function clampUnit(value: number): number {
  if (Number.isNaN(value)) return 0
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** The frame under a bar position (fraction of the played axis). Clamped to the document. */
export function frameAt(fraction: number, frameCount: number): number {
  const last = Math.max(0, frameCount - 1)
  if (last <= 0) return 0
  return Math.round(clampUnit(fraction) * last)
}

/** The bar position of a frame (fraction of the played axis). Clamped to [0, 1]. */
export function fractionAtFrame(frame: number, frameCount: number): number {
  const last = Math.max(0, frameCount - 1)
  if (last <= 0) return 0
  return clampUnit(frame / last)
}
