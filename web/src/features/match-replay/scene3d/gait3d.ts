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
  g.distance = lerpAt(dist, now)
  g.speed = 0
  g.heading = 0
  const from = Math.max(pts[0].t, f - GAIT_WINDOW * fps)
  const seconds = (f - from) / fps
  if (seconds <= 0) return g
  const then = bracketAt(pts, from, THEN)
  const a = pts[then.lo]
  const b = pts[then.hi]
  const c = pts[now.lo]
  const d = pts[now.hi]
  const dx = c.x + (d.x - c.x) * now.u - (a.x + (b.x - a.x) * then.u)
  const dy = c.y + (d.y - c.y) * now.u - (a.y + (b.y - a.y) * then.u)
  const moved = Math.min(Math.hypot(dx, dy), g.distance - lerpAt(dist, then))
  g.heading = (Math.atan2(dy, dx) * 180) / Math.PI
  g.speed = moved / seconds
  return g
}
