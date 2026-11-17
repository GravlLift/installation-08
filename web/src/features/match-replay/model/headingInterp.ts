// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * headingInterp — THE HEADING BETWEEN TWO SAMPLES, by the shortest angular path.
 *
 * WHY (v8 checks, 2026-10-21, witness 7b0d89c4: « rotations saccadées des véhicules » [jerked rotations of the vehicles]). The
 * film publishes one heading per document frame (10 Hz) and the render spins on screen much faster: the
 * POSITION of a vehicle interpolates between two samples (`positionAt`), its HEADING was held at the
 * last sample — the sprite glided continuously then turned in 100 ms jerks. A heading
 * interpolates on the circle: from 350 to 10 degrees, the path is +20, not -340 (hence the
 * shortest path, and not an arithmetic mean).
 *
 * WHAT THIS INTERPOLATION DOES NOT DO, AND THAT IS INTENTIONAL:
 *  - it never crosses a REPLICATION SILENCE (`g > 0`): like the
 *    position, the heading is held at the preceding point — a vehicle does not turn while the film
 *    is silent;
 *  - it does not fill a gap longer than `HEADING_INTERP_MAX_SPAN_FRAMES`: beyond that, the two
 *    readings no longer belong to the same motion and the heading stays held (a turn smoothed over
 *    ten seconds would be an invention).
 *
 * No React, no canvas: dated arithmetic, testable on its own.
 */

/**
 * Maximum gap, in frames, between two heading readings for one to turn from one to the other. One
 * second (10 frames): the same order as the hold of an aim reading
 * (`VEHICLE_AIM_HOLD_FRAMES`), for the same reason — beyond that, it is no longer a continuous stream.
 */
export const HEADING_INTERP_MAX_SPAN_FRAMES = 10

/** A point that carries (or not) a heading: a vehicle sample or an aim reading. */
export interface HeadingPoint {
  t: number
  h?: number
  /** Replication silence that PRECEDES this point (ms): one does not turn across it. */
  g?: number
}

/**
 * lerpHeadingDeg — the heading at fraction `f` (0..1) from `from` to `to`, by the SHORTEST path
 * (gap brought into [-180, 180)). The result is brought into [0, 360).
 */
export function lerpHeadingDeg(from: number, to: number, f: number): number {
  const delta = ((((to - from) % 360) + 540) % 360) - 180
  return (((from + delta * f) % 360) + 360) % 360
}

/**
 * headingTowardNext — the heading at `frame`, knowing that `points[prevIdx]` is the last heading
 * reading at latest at that instant. If there is a following heading reading, reachable without
 * crossing a silence and at less than `maxSpanFrames`, the heading turns toward it; otherwise it
 * stays the one of `points[prevIdx]`. `prevIdx` must designate a point that carries a heading.
 */
export function headingTowardNext(
  points: readonly HeadingPoint[],
  prevIdx: number,
  frame: number,
  maxSpanFrames: number = HEADING_INTERP_MAX_SPAN_FRAMES,
): number {
  const prev = points[prevIdx]
  const held = prev.h as number
  if (frame <= prev.t) return held
  for (let j = prevIdx + 1; j < points.length; j++) {
    const next = points[j]
    if ((next.g ?? 0) > 0) return held
    if (next.t - prev.t > maxSpanFrames) return held
    if (next.h === undefined || next.t <= frame) continue
    return lerpHeadingDeg(held, next.h, (frame - prev.t) / (next.t - prev.t))
  }
  return held
}
