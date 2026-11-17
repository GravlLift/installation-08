// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shields3d.ts — A PLAYER'S SHIELD, read from their track for the body's effects.
 *
 * The document publishes, per track point, the shield fraction (`Point.sh`, 0..1, capped at 1:
 * an overshield isn't distinguishable there). The film only replicates it ON CHANGE: a drop is a
 * hit taken, a drop to zero a break, a run of frame-by-frame rises a recharge (measured on
 * 512155b9: 962 drops including 235 breaks, rises of 0.047 per frame).
 *
 * The effects are a FUNCTION OF THE FRAME: the hit's glow decays with time elapsed since the last
 * drop published before the frame, the break with time since the last drop to zero, recharge
 * holds as long as two neighboring measurements around the frame rise. Nothing accumulates:
 * stepping forward, back, or jumping gives the same value at the same frame.
 */

/** A life's shield measurements, sorted by frame (only the points that carry one). */
export interface ShieldSamples {
  t: number[]
  v: number[]
}

/** What the body shows of the shield at a frame. */
export interface ShieldFx {
  /** The glow of a hit taken (0..1), stronger for a bigger drop, decaying. */
  hit: number
  /** The break (0..1): 1 at the instant the shield hits zero, then decaying. */
  broke: number
  /** Time (s) since the break, -1 with no break in progress: the flash grows with it. */
  breakAge: number
  /** The recharge (0 or 1): the shield is rising around the frame. */
  recharge: number
  /** Time (s) since the start of the current rise, -1 outside a recharge. */
  rechargeAge: number
}

/** Duration of a hit's glow (s): sustained fire keeps it lit, it fades after the last one. */
export const HIT_SECONDS = 0.4
/** Duration of a break's flash (s): a brief spark. */
export const BREAK_SECONDS = 0.25
// Below this, a difference between measurements isn't a change (publishing rounds).
const EPS = 0.005
// Two rising measurements more than this many frames apart aren't a recharge: the film replicates
// the recharge every frame (measured), a longer gap is a replication gap.
const RECHARGE_GAP_FRAMES = 2
// A drop's glow: a floor, plus a share of the drop (0.25 = a BR shot gives ~0.9).
const HIT_FLOOR = 0.4
const HIT_PER_DROP = 2

export const NO_SHIELD_FX: Readonly<ShieldFx> = Object.freeze({ hit: 0, broke: 0, breakAge: -1, recharge: 0, rechargeAge: -1 })

/** lastAtOrBefore: the index of the last measurement at frame `f` or before, -1 if there is none. */
function lastAtOrBefore(t: readonly number[], f: number): number {
  let lo = 0
  let hi = t.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (t[mid] <= f) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/**
 * shieldFxAt: what the body shows of the shield at frame `f` (fractional), `fps` frames per
 * second. `out` receives the result (no per-frame allocation) and is returned.
 */
export function shieldFxAt(s: ShieldSamples, f: number, fps: number, out: ShieldFx): ShieldFx {
  Object.assign(out, NO_SHIELD_FX)
  const { t, v } = s
  const k = lastAtOrBefore(t, f)
  if (k < 0) return out
  const window = Math.max(HIT_SECONDS, BREAK_SECONDS) * fps
  for (let j = k; j >= 1 && f - t[j] < window; j--) {
    if (v[j] >= v[j - 1] - EPS) continue
    const age = (f - t[j]) / fps
    if (age < HIT_SECONDS) {
      const u = 1 - age / HIT_SECONDS
      out.hit = u * u * Math.min(1, HIT_FLOOR + HIT_PER_DROP * (v[j - 1] - v[j]))
    }
    if (v[j] <= EPS && v[j - 1] > EPS && age < BREAK_SECONDS) {
      out.broke = 1 - age / BREAK_SECONDS
      out.breakAge = age
    }
    break
  }
  out.recharge = rising(t, v, k, k + 1) || (f - t[k] <= RECHARGE_GAP_FRAMES && rising(t, v, k - 1, k)) ? 1 : 0
  if (out.recharge > 0) {
    // The rise's start: the first measurement of the rising run that leads to the frame.
    let start = k
    while (rising(t, v, start - 1, start)) start--
    out.rechargeAge = Math.max(0, (f - t[start]) / fps)
  }
  return out
}

/** rising: measurement `b` closely follows `a` and rises. */
function rising(t: readonly number[], v: readonly number[], a: number, b: number): boolean {
  return a >= 0 && b < t.length && t[b] - t[a] <= RECHARGE_GAP_FRAMES && v[b] > v[a] + EPS
}

/** shieldSamplesOf: the shield measurements of a track's points (those that carry one). */
export function shieldSamplesOf(points: readonly { t: number; sh?: number }[]): ShieldSamples {
  const out: ShieldSamples = { t: [], v: [] }
  for (const p of points) {
    if (p.sh === undefined) continue
    out.t.push(p.t)
    out.v.push(p.sh)
  }
  return out
}
