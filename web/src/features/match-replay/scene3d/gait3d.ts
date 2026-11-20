// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * gait3d.ts — A PLAYER'S GAIT READ FROM THEIR TRACK: ground speed, direction of travel, and
 * distance traveled since the start of their life, at a (fractional) frame.
 *
 * Everything is derived from the life's points, statelessly: the same frame yields the same
 * gait, forward or backward through the replay. Distance is the length of the ground path,
 * accumulated point to point (a replication gap, `g` > 0, adds none: the position jumps there,
 * the player doesn't walk it); it drives the locomotion clips' phase (`motion3d`), which thus
 * follows the ground rather than the clock. Speed is measured over a window (`GAIT_WINDOW`) that
 * smooths the jitter of published positions.
 *
 * Halo world units (u, X and Y on the ground), document frames; `fps` converts to seconds.
 */

/** A track point, as the 3D view holds it. */
export interface GaitPoint {
  t: number
  x: number
  y: number
  /** > 0: replication gap BEFORE this point (no interpolation across it). */
  g: number
}

/** A player's gait at one frame. */
export interface Gait {
  /** Ground speed (u/s). */
  speed: number
  /** Direction of travel (degrees, like heading: 0 = +X Halo, 90 = +Y). */
  heading: number
  /** Ground distance traveled since the start of life (u). */
  distance: number
}

/** The speed measurement window (s): two frames at the films' 10 frames/s rate. */
export const GAIT_WINDOW = 0.2

/** The interval of points bracketing frame `f` and the fraction `u` of the path from `lo` to `hi`. */
export interface Bracket {
  lo: number
  hi: number
  u: number
}

/**
 * bracketAt: the points bracketing frame `f` (clamped to the life's ends). After a replication
 * gap, the position holds (`u` = 0) until the next point. Written into `out` when given.
 */
export function bracketAt(pts: readonly GaitPoint[], f: number, out?: Bracket): Bracket {
  const br = out ?? { lo: 0, hi: 0, u: 0 }
  let lo = 0
  let hi = pts.length - 1
  br.u = 0
  if (f <= pts[0].t) hi = 0
  else if (f >= pts[hi].t) lo = hi
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (pts[mid].t <= f) lo = mid
      else hi = mid
    }
    const b = pts[hi]
    br.u = b.g > 0 ? 0 : (f - pts[lo].t) / (b.t - pts[lo].t)
  }
  br.lo = lo
  br.hi = hi
  return br
}

/** lifeDistances: the cumulative ground distance at each point of the life (u), 0 at the first. */
export function lifeDistances(pts: readonly GaitPoint[]): number[] {
  const out = new Array<number>(pts.length)
  let d = 0
  pts.forEach((p, i) => {
    if (i > 0 && p.g <= 0) d += Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y)
    out[i] = d
  })
  return out
}

/** lerpAt: the per-point value `values` at interval `br`, interpolated. */
export function lerpAt(values: ArrayLike<number>, br: Bracket): number {
  return values[br.lo] + (values[br.hi] - values[br.lo]) * br.u
}

/*
 * C1 INTERPOLATION THROUGH THE POINTS (2026-11-19).
 *
 * Linear interpolation is C0: the velocity jumps at every point. Points come at the film's
 * replication rate (30 or 60 per second, `fineTracks3d`), so at normal speed that is invisible,
 * but at 0.25x slow motion a 30 Hz track steps every 8 drawn frames, and a body or a camera
 * following it copies the steps. `cubicAt` is a piecewise cubic Hermite in TIME through the
 * points with monotone (Fritsch-Butland, PCHIP) slopes, one value axis at a time:
 *  - it passes every published point exactly (the game's samples are never moved);
 *  - its velocity is continuous at every interior point (each point's slope depends only on its
 *    two neighbors, so both segments sharing it see the same slope);
 *  - it never overshoots: inside a segment each axis stays between the segment's two values (the
 *    curve stays in the box its two points span), and a slope is 0 where the axis turns back or
 *    stays flat. A sudden stop does not carry the body past the stop, a silence held by
 *    `fineTracks3d`'s repeated point stays perfectly still, and a sharp turn cannot swing wide
 *    of its corner. A Catmull-Rom (centripetal or not) does overshoot on a stop, and is
 *    parametrized by chord, not by time, so it would not keep the samples' timing.
 * The slopes use the true time spacing of the neighbors (uneven replication is common). No
 * denoising beyond that: the curve must pass through the samples, and a slope from a wider
 * stencil disagrees with the local chords and adds a wiggle inside the segment instead of
 * removing one. Smoothing that is allowed to leave the samples belongs to the consumer that
 * wants it (a follow camera's `smooth`, `cameraScript3d.ts`).
 *
 * A replication gap (`g` > 0 on `hi`) holds `lo`'s value as `bracketAt` does (`u` = 0). A
 * neighbor across a gap, across the life's ends, or at the same instant is not a neighbor: that
 * end's slope is the segment's own chord (one-sided).
 */

/** The slope (per frame) at a point between chords `d1` (over `h1` frames) and `d2` (over `h2`): 0 at an extremum or a flat. */
function monotoneSlope(h1: number, d1: number, h2: number, d2: number): number {
  if (d1 * d2 <= 0) return 0
  const w1 = 2 * h2 + h1
  const w2 = h2 + 2 * h1
  return (w1 + w2) / (w1 / d1 + w2 / d2)
}

/**
 * cubicAt: the value at bracket `br` of a per-point series whose values at `lo - 1`, `lo`, `hi`
 * and `hi + 1` are `vPrev`, `v0`, `v1` and `vNext` (a neighbor that does not exist may carry any
 * finite value; it is not read). C1 monotone cubic in time, see above.
 */
export function cubicAt(pts: readonly GaitPoint[], br: Bracket, vPrev: number, v0: number, v1: number, vNext: number): number {
  const { lo, hi, u } = br
  if (u <= 0 || lo === hi) return v0
  if (u >= 1) return v1
  const t0 = pts[lo].t
  const t1 = pts[hi].t
  const h = t1 - t0
  const d = (v1 - v0) / h
  let m0 = d
  let m1 = d
  if (lo > 0 && pts[lo].g <= 0 && pts[lo - 1].t < t0) {
    const hp = t0 - pts[lo - 1].t
    m0 = monotoneSlope(hp, (v0 - vPrev) / hp, h, d)
  }
  if (hi + 1 < pts.length && pts[hi + 1].g <= 0 && pts[hi + 1].t > t1) {
    const hn = pts[hi + 1].t - t1
    m1 = monotoneSlope(h, d, hn, (vNext - v1) / hn)
  }
  const u2 = u * u
  const u3 = u2 * u
  // The Hermite form written from v0, so a flat segment (v0 = v1, slopes 0) is exactly v0.
  return v0 + (v1 - v0) * (3 * u2 - 2 * u3) + h * (m0 * (u3 - 2 * u2 + u) + m1 * (u3 - u2))
}

/** smoothAt: the per-point value `values` at interval `br`, on the C1 curve (`cubicAt`). */
export function smoothAt(pts: readonly GaitPoint[], values: ArrayLike<number>, br: Bracket): number {
  const { lo, hi } = br
  return cubicAt(pts, br, values[lo > 0 ? lo - 1 : lo], values[lo], values[hi], values[hi + 1 < values.length ? hi + 1 : hi])
}

/** axisAt: a coordinate of the points at interval `br`, on the C1 curve (`cubicAt`). */
export function axisAt<K extends string>(pts: readonly (GaitPoint & Record<K, number>)[], key: K, br: Bracket): number {
  const { lo, hi } = br
  return cubicAt(pts, br, pts[lo > 0 ? lo - 1 : lo][key], pts[lo][key], pts[hi][key], pts[hi + 1 < pts.length ? hi + 1 : hi][key])
}

/** angleStep: the shortest path from heading `a` to heading `b` (degrees, in [-180, 180)). */
export function angleStep(a: number, b: number): number {
  return ((((b - a) % 360) + 540) % 360) - 180
}

/**
 * headingAt: the heading (degrees) of points carrying `h` at interval `br`, on the C1 curve
 * (`cubicAt`). Each neighbor is unwrapped by the shortest arc from the point next to it (the same
 * rule as the linear step), so a turn across 359 -> 1 stays two degrees. The result is in `lo`'s
 * turn (it may leave [0, 360)); it equals `lo`'s heading at `u` = 0 and `hi`'s, modulo 360, at 1.
 */
export function headingAt(pts: readonly (GaitPoint & { h: number })[], br: Bracket): number {
  const { lo, hi } = br
  const h0 = pts[lo].h
  const h1 = h0 + angleStep(h0, pts[hi].h)
  const hPrev = lo > 0 ? h0 - angleStep(pts[lo - 1].h, h0) : h0
  const hNext = hi + 1 < pts.length ? h1 + angleStep(pts[hi].h, pts[hi + 1].h) : h1
  return cubicAt(pts, br, hPrev, h0, h1, hNext)
}

// The brackets `gaitAt` uses, rewritten on every call.
const NOW: Bracket = { lo: 0, hi: 0, u: 0 }
const THEN: Bracket = { lo: 0, hi: 0, u: 0 }

/**
 * gaitAt: the gait at frame `f` of a life of points `pts` (distances `dist` from
 * `lifeDistances`), `fps` frames per second. Speed is the displacement over the window, never
 * more than the path traveled within that window: a replication-gap jump doesn't count. Written
 * into `out` when given (no allocation), otherwise into a fresh gait.
 */
export function gaitAt(pts: readonly GaitPoint[], dist: readonly number[], f: number, fps: number, out?: Gait): Gait {
  const g = out ?? { speed: 0, heading: 0, distance: 0 }
  const now = bracketAt(pts, f, NOW)
  // Distance and positions on the same C1 curve as the body (`tracks3d`), so the locomotion
  // phase and the speed change as smoothly as the body moves.
  g.distance = smoothAt(pts, dist, now)
  g.speed = 0
  g.heading = 0
  const from = Math.max(pts[0].t, f - GAIT_WINDOW * fps)
  const seconds = (f - from) / fps
  if (seconds <= 0) return g
  const then = bracketAt(pts, from, THEN)
  const dx = axisAt(pts, 'x', now) - axisAt(pts, 'x', then)
  const dy = axisAt(pts, 'y', now) - axisAt(pts, 'y', then)
  const moved = Math.min(Math.hypot(dx, dy), g.distance - smoothAt(pts, dist, then))
  g.heading = (Math.atan2(dy, dx) * 180) / Math.PI
  g.speed = moved / seconds
  return g
}
