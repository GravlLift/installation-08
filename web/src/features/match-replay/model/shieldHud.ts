// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldHud.ts — the first-person HUD's shield bar, read from one life's shield samples.
 *
 * WHAT THE FILM CARRIES (measured on two schema-125 films, 33 ms frames): `Point.sh` is quantized
 * to 1/64 and replicated on almost every frame while it changes. A recharge climbs about 1/61 per
 * frame (empty to full in 61 frames, 2.0 s) and starts about 150 frames (5 s) after the last drop.
 * A few rises skip frames (replication gaps up to ~16 frames), which a held reading shows as one
 * jump of 0.14. Read as "last sample", the bar therefore moved in 1/64 steps 30 times a second,
 * plus those jumps.
 *
 * THE BAR IS A PURE FUNCTION OF THE FRAME. A drop is instant at its sample. A rise ENDS at its
 * sample and climbs at the game's recharge rate (`SHIELD_RECHARGE_FULL_MS`), starting late enough
 * to arrive on time, or right at the previous sample when the samples climb faster than that rate.
 * Seeking, rewinding and playing give the same value at the same frame.
 *
 * THE STATE comes from a transition list built once per life, so the bar and anything hooked to the
 * transitions (the shield sounds) always agree.
 */
import { shieldSamplesOf, type ShieldSamples } from '../scene3d/shields3d'

export type ShieldHudState = 'full' | 'damaged' | 'low' | 'broken' | 'recharging'

/** The bar at one frame: its fill (0..1), its state, and the frame that state began. */
export interface ShieldHudReading {
  fraction: number
  state: ShieldHudState
  /** The (fractional) frame the current state began: a flash or a sound cadence counts from it. */
  since: number
}

/** One state change of a life: from `frame` (fractional) on, the bar is in `state`. */
export interface ShieldTransition {
  frame: number
  state: ShieldHudState
}

/** A life's shield, ready to read at any frame (`shieldHudAt`). */
export interface ShieldHudTrack {
  samples: ShieldSamples
  /** Per sample i: the frame where the rise toward sample i+1 begins (t[i] when it is no rise). */
  rampStart: number[]
  /** The state changes, the first at the life's start; `frame` ascending. */
  transitions: ShieldTransition[]
}

/** Time to refill an empty shield (measured: 61 frames of 33 ms, see the file header). */
export const SHIELD_RECHARGE_FULL_MS = 2000
/**
 * Below this fraction a shield that is not recharging is `low` (the bar flashes red). A design
 * choice: the captures of the game show only a full bar, so the game's own threshold is unread.
 */
export const SHIELD_LOW_FRACTION = 0.25
// Below this difference two samples are the same value (half a 1/64 step).
const EPS = 0.005
// A state run shorter than this between two runs of the same state is noise (a recharge sample
// that repeats its value for one frame) and merges into its neighbors.
const MIN_RUN_FRAMES = 3

function classify(v: number, rising: boolean): ShieldHudState {
  if (rising) return 'recharging'
  if (v >= 1 - EPS) return 'full'
  if (v <= EPS) return 'broken'
  return v < SHIELD_LOW_FRACTION ? 'low' : 'damaged'
}

const rises = (v: readonly number[], i: number) => i + 1 < v.length && v[i + 1] > v[i] + EPS

/**
 * shieldHudTrackOf builds one life's shield bar from its points (`{ t, sh? }`, by frame), the
 * film's frame interval and the life's first frame. Before the first sample the bar is full (a
 * Spartan spawns full and the film replicates only changes, cf. `playerStateAt`).
 */
export function shieldHudTrackOf(points: readonly { t: number; sh?: number }[], frameIntervalMs: number, startFrame = points[0]?.t ?? 0): ShieldHudTrack {
  const samples = shieldSamplesOf(points)
  const { t, v } = samples
  const fullFrames = SHIELD_RECHARGE_FULL_MS / Math.max(1, frameIntervalMs)
  const rampStart = t.map((ti, i) => (rises(v, i) ? Math.max(ti, t[i + 1] - (v[i + 1] - v[i]) * fullFrames) : ti))
  // The pieces: before the first sample (full), then per sample a hold at its value until the ramp
  // starts, then the ramp (recharging) until the next sample.
  let runs: ShieldTransition[] = [{ frame: Math.min(startFrame, t[0] ?? startFrame), state: 'full' }]
  for (let i = 0; i < t.length; i++) {
    runs.push({ frame: t[i], state: classify(v[i], false) })
    if (rises(v, i)) runs.push({ frame: rampStart[i], state: 'recharging' })
  }
  runs = collapse(runs.filter((r, i) => i + 1 >= runs.length || runs[i + 1].frame > r.frame))
  // A per-frame recharge alternates a sliver of hold at each sample with its ramp, and sometimes
  // repeats a value for a frame: those holds belong to the recharge. Then a recharge too short to
  // matter (a one-frame blip) belongs to the states around it.
  runs = mergeShort(runs, (s) => s !== 'recharging')
  runs = mergeShort(runs, (s) => s === 'recharging')
  return { samples, rampStart, transitions: runs }
}

function collapse(runs: ShieldTransition[]): ShieldTransition[] {
  return runs.filter((r, i) => i === 0 || r.state !== runs[i - 1].state)
}

/** mergeShort: a run of an `eligible` state shorter than MIN_RUN_FRAMES between two runs of one same state joins them. */
function mergeShort(runs: ShieldTransition[], eligible: (s: ShieldHudState) => boolean): ShieldTransition[] {
  const out = runs.slice()
  for (let i = 1; i + 1 < out.length; ) {
    if (eligible(out[i].state) && out[i + 1].frame - out[i].frame < MIN_RUN_FRAMES && out[i - 1].state === out[i + 1].state) out.splice(i, 2)
    else i++
  }
  return out
}

function lastAtOrBefore<T>(xs: readonly T[], f: number, at: (x: T) => number): number {
  let lo = 0
  let hi = xs.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (at(xs[mid]) <= f) lo = mid + 1
    else hi = mid
  }
  return lo - 1
}

/** shieldFractionAt: the bar's fill at frame `f` (fractional), instant drops, ramped rises. */
export function shieldFractionAt(track: ShieldHudTrack, f: number): number {
  const { t, v } = track.samples
  const k = lastAtOrBefore(t, f, (x) => x)
  if (k < 0) return 1
  if (!rises(v, k)) return v[k]
  const start = track.rampStart[k]
  if (f <= start) return v[k]
  return v[k] + (v[k + 1] - v[k]) * Math.min(1, (f - start) / (t[k + 1] - start))
}

/** Shield state at a frame: `{ fraction, state, since }`, a pure function of `f`; the state changes are `track.transitions`. */
export function shieldHudAt(track: ShieldHudTrack, f: number): ShieldHudReading {
  const j = Math.max(0, lastAtOrBefore(track.transitions, f, (x) => x.frame))
  const run = track.transitions[j]
  return { fraction: Math.max(0, Math.min(1, shieldFractionAt(track, f))), state: run.state, since: run.frame }
}

/**
 * shieldTransitionsOf: the frames where a life's shield goes low, breaks, starts recharging,
 * becomes damaged or full again (the hook for shield sounds), first entry at the life's start.
 */
export function shieldTransitionsOf(points: readonly { t: number; sh?: number }[], frameIntervalMs: number, startFrame?: number): ShieldTransition[] {
  return shieldHudTrackOf(points, frameIntervalMs, startFrame).transitions
}

/** The low and broken bar's flash period (a design choice; the captures show no low shield). */
export const SHIELD_FLASH_PERIOD_MS = 400

/**
 * shieldFlash (0..1): the low and broken bar's pulse, `periodMs` long, counted from the state's
 * start so it reads the same at the same frame whatever the playback did before.
 */
export function shieldFlash(sinceMs: number, nowMs: number, periodMs = SHIELD_FLASH_PERIOD_MS): number {
  const phase = Math.max(0, nowMs - sinceMs) / periodMs
  return 0.5 + 0.5 * Math.cos(2 * Math.PI * phase)
}
