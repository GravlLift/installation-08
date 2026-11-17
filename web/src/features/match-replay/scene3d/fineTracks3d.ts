// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * fineTracks3d.ts — A LIFE AT THE FILM'S OWN RATE, TURNED INTO POINTS FOR THE 3D VIEW.
 *
 * `tracks[].fullRate` (schema 109, read back by `lib/replay/replayFullRate.ts`) carries every
 * position and every aim the film replicates, at its own instant: 60 or 30 per second depending
 * on the film, versus one point per 100 ms frame in `points`. This module derives from it the
 * sequence of points that `tracks3d.ts` interpolates, in place of the grid's points.
 *
 * TWO TIME AXES, AND NEITHER IS FOLDED ONTO THE OTHER AT PLAYBACK TIME. Points follow the
 * POSITIONS' instants; each point's aim is read on the AIM axis, at the point's instant
 * (interpolated between the two aims bracketing it). Since every published aim comes from a
 * position record, every aim instant is also a point instant: the aim there is exact.
 *
 * SILENCE IS NOT SLOW MOVEMENT. The film only replicates what changes: a motionless body stays
 * silent, then the first record after the silence describes the step of ONE tick. Interpolating
 * across the whole silence would slide the player while they were motionless; so the last value
 * is held until one tick before the next sample (`holdUntil`), for both positions and aim. A GAP
 * (`gaps`, more than 5 s) remains a break: the point that follows it carries `g = 1`, and
 * interpolation does not cross it (`gait3d.bracketAt`).
 */
import type { ReplayFullRateReady } from '@/lib/replay/replayFullRate'

/** A life point at the film's rate: the shape `tracks3d.ts` interpolates. */
export interface FineLifePoint {
  t: number
  x: number
  y: number
  z: number
  g: number
  h: number
  p: number
  aim: boolean
}

/** Beyond this many ticks without a sample, the value is held instead of interpolated. */
export const HOLD_AFTER_TICKS = 3

/** The life's tick, in frames: the median gap between two positions (fallback: 60 Hz over 100 ms). */
export function lifeTick(t: readonly number[]): number {
  const dts: number[] = []
  for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) dts.push(t[i] - t[i - 1])
  if (dts.length === 0) return 1 / 6
  dts.sort((a, b) => a - b)
  return dts[dts.length >> 1]
}

/**
 * aimAt: the aim (heading, pitch, in degrees) at frame `f`, read on the aim axis. Before the
 * first aim, the first; after the last, the last; between two close aims, interpolation (heading
 * via the shortest path); after a silence, held until one tick before the next. `known` says an
 * aim precedes `f`.
 */
export function aimAt(fr: ReplayFullRateReady, f: number, tick: number): { h: number; p: number; known: boolean } {
  const n = fr.aimT.length
  if (n === 0) return { h: 0, p: 0, known: false }
  if (f < fr.aimT[0]) return { h: fr.h[0], p: fr.p[0], known: false }
  let lo = 0
  let hi = n - 1
  if (f >= fr.aimT[hi]) return { h: fr.h[hi], p: fr.p[hi], known: true }
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (fr.aimT[mid] <= f) lo = mid
    else hi = mid
  }
  const u = holdFraction(fr.aimT[lo], fr.aimT[hi], f, tick)
  const dh = ((fr.h[hi] - fr.h[lo] + 540) % 360) - 180
  return { h: fr.h[lo] + dh * u, p: fr.p[lo] + (fr.p[hi] - fr.p[lo]) * u, known: true }
}

/** The interpolation fraction between `a` and `b` at `f`, held at 0 until one tick before `b` after a silence. */
function holdFraction(a: number, b: number, f: number, tick: number): number {
  if (b <= a) return 0
  const from = b - a > HOLD_AFTER_TICKS * tick ? b - tick : a
  return f <= from ? 0 : (f - from) / (b - from)
}

/**
 * fineLifePoints: the life's points at the film's rate, aim included. After a silence longer
 * than `HOLD_AFTER_TICKS` ticks (outside a gap), a holding point repeats the previous position
 * one tick before the sample that follows the silence, so `tracks3d`'s linear interpolation
 * holds the body still during the silence.
 */
export function fineLifePoints(fr: ReplayFullRateReady): FineLifePoint[] {
  const tick = lifeTick(fr.t)
  const gaps = new Set(fr.gaps)
  const out: FineLifePoint[] = []
  const at = (t: number, i: number, g: number): FineLifePoint => {
    const a = aimAt(fr, t, tick)
    return { t, x: fr.x[i], y: fr.y[i], z: fr.z[i], g, h: a.h, p: a.p, aim: a.known }
  }
  for (let i = 0; i < fr.t.length; i++) {
    const gap = gaps.has(i)
    if (i > 0 && !gap && fr.t[i] - fr.t[i - 1] > HOLD_AFTER_TICKS * tick) {
      out.push(at(fr.t[i] - tick, i - 1, 0))
    }
    out.push(at(fr.t[i], i, gap ? 1 : 0))
  }
  return out
}
