// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayFullRate.ts — THE LIFE AT THE FILM'S RATE (schema 109), re-read at the boundary.
 *
 * The server publishes, alongside the grid points (`tracks[].points`, one per frame), ALL the
 * position and aim samples the film replicates for the life (`tracks[].fullRate`), as
 * DIFFERENTIAL integer columns: a column's first value is absolute, each following one is the
 * gap from the previous. The producer describes its encoding
 * (`libs/film/replay/tracks_plein_debit.go`); this module is its ONLY reader.
 *
 * WHAT THE READING RETURNS, in the units of the rest of the document:
 *  - `t`, `aimT`: each sample's FRACTIONAL FRAME (milliseconds / `frameIntervalMs`), on the
 *    same axis as `points[].t` — its whole part is the frame the grid files it under;
 *  - `x`, `y`, `z`: world units, the values of `points[]` (centi-units);
 *  - `h`, `p`: degrees, same conventions as `points[].h` / `points[].p`, at the film's quantum
 *    (heading 360/4096, elevation 360/2048) instead of the rounded tenth of a degree;
 *  - `gaps`: the indices of the samples a GAP precedes (the rule of `points[].g`) — we hold
 *    the position up to them, we do not interpolate across.
 *
 * Position and aim keep EACH of their own instants: aim does not arrive on every position
 * record, and the reading does not resample one onto the other.
 */
import type { ReplayFullRateTrack } from '@/lib/api/types'

/** Heading quanta per turn (R(12) of the i21 component). */
export const FULL_RATE_HEADING_QUANTA = 4096
/** Elevation quanta per turn, centered on the half (R(11) of the i21 component). */
export const FULL_RATE_PITCH_QUANTA = 2048

/** The life at the film's rate, re-read: see the module header. */
export interface ReplayFullRateReady {
  t: number[]
  x: number[]
  y: number[]
  z: number[]
  gaps: number[]
  aimT: number[]
  h: number[]
  p: number[]
}

/**
 * Cumulative sum of a differential column, divided by `divisor` (null = empty column). The sum
 * stays INTEGER and the division comes last: `1234 / 100` returns exactly the number
 * `JSON.parse("12.34")` returns for the grid point.
 */
function cumulate(col: readonly number[] | null | undefined, divisor: number): number[] {
  const values = col ?? []
  const out = new Array<number>(values.length)
  let acc = 0
  for (let i = 0; i < values.length; i++) {
    acc += values[i]
    out[i] = acc / divisor
  }
  return out
}

/**
 * decodeFullRate re-reads a life's full-rate track. `frameIntervalMs` is the document's
 * (`frameIntervalMs`), which fixes the frame scale.
 */
export function decodeFullRate(raw: ReplayFullRateTrack, frameIntervalMs: number): ReplayFullRateReady {
  const hq = cumulate(raw.h, 1)
  const pq = cumulate(raw.p, 1)
  return {
    t: cumulate(raw.t, frameIntervalMs),
    x: cumulate(raw.x, 100),
    y: cumulate(raw.y, 100),
    z: cumulate(raw.z, 100),
    gaps: [...(raw.gaps ?? [])],
    aimT: cumulate(raw.aimT, frameIntervalMs),
    h: hq.map((q) => ((q + 0.5) * 360) / FULL_RATE_HEADING_QUANTA),
    p: pq.map((q) => ((q + 0.5) * 360) / FULL_RATE_PITCH_QUANTA - 180),
  }
}

/**
 * The flight AT THE FILM'S RATE (schema 127, `Projectile.fullRate`), re-read: every raw sample
 * at its own instant, differential integer columns (the projectile twin of `FullRateTrack`).
 * `t` in fractional frames (ms / `frameIntervalMs`), `x`/`y`/`z` in world units (centi-units).
 */
export interface ReplayFullRateFlightReady {
  t: number[]
  x: number[]
  y: number[]
  z: number[]
}

/** The raw shape of `Projectile.fullRate` (schema 127): differential integer columns. */
export interface ReplayFullRateFlightRaw {
  t?: number[] | null
  x?: number[] | null
  y?: number[] | null
  z?: number[] | null
}

/**
 * decodeFullRateFlight re-reads a projectile's full-rate flight. `frameIntervalMs` is the
 * document's, which fixes the frame scale. The flight has no aim or stick (a projectile
 * carries neither), so only `t`, `x`, `y`, `z` are read.
 */
export function decodeFullRateFlight(raw: ReplayFullRateFlightRaw, frameIntervalMs: number): ReplayFullRateFlightReady {
  return {
    t: cumulate(raw.t, frameIntervalMs),
    x: cumulate(raw.x, 100),
    y: cumulate(raw.y, 100),
    z: cumulate(raw.z, 100),
  }
}
