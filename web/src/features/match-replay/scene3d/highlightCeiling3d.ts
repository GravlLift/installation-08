// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * highlightCeiling3d.ts — THE HIGHLIGHT CEILING: an exposure that can only come DOWN, metered on
 * the frame, so the frame's pale surfaces keep detail. Pure part: the model of the view's output
 * chain, the ceiling's rule, and the clock its smoothing runs on. The GPU half (metering the frame,
 * smoothing, applying) is `highlightMeter3d.ts`; the compositor wires it (`postFx3d.ts`).
 *
 * WHY. A camera script's film look (`filmLook3d`) stacks its exposure (stops) and its film curve
 * (contrast 1.35 at mid grey, a shoulder rolling into white) on top of the view's ACES curve and
 * grade. On Recharge's pregame spawn room (demo-3-recharge-pregame, `look.exposure` 0.5), the
 * export's white wall and white armor sat at linear 0.24 and 0.35 (the export's pixels inverted
 * through this chain; the frame's median was 0.09 to 0.13, darker than the 0.23 the view's
 * exposure was tuned on). The default view draws those at G 162 and 188; the look drew them at 201
 * and 222, where its curve has only 13 to 23 code values per stop left against the default's 27
 * to 38: the detail of a white surface is flattened into white. The base scene was not over-lit:
 * the look pushed ordinary highlights into the shoulder.
 *
 * THE RULE, per frame. P is the frame's highlight level: the 97th percentile of the scene's linear
 * luminance (before exposure), self-lit pixels excluded (brightest channel above the bloom
 * threshold: they are meant to glow). The ceiling is the smallest darkening c (stops, 0 to
 * -`CEILING_MAX_STOPS`) under which the chain drawing the frame still renders P with at least
 * - the default view's own detail at P (a film look never draws the frame's highlights flatter
 *   than the game-matched view would), and
 * - the detail floor: the default view's detail at `DETAIL_FLOOR_LUMINANCE`, a white surface under
 *   the full sun (SUN_INTENSITY / pi x (1 + SKY_FILL_SHARE) = 1.27). Lit surfaces brighter than
 *   that are past what the view's lights are made to give.
 * "Detail" is the chain's slope: screen luma code values per stop of light (`chainSlope`).
 * Darkening never goes below the chain's own steepest point (below it, darker is flatter).
 *
 * UNSCRIPTED PLAYBACK. Without a look the first condition is the default against itself, always
 * met; only the floor can act, and only on a frame whose highlight level is above 1.27. On the
 * eleven no-look exports on disk (2026-11-20, 2 frames a second) the highest highlight level was
 * 1.24 (this same spawn room) and every other room stayed at or under 0.75: the ceiling is exactly
 * 0 there (the table holds 0, the shader multiplies by exp2(0) = 1).
 *
 * TIME. The ceiling eases toward each frame's value with time constant `CEILING_TAU_MS`, on a
 * clock the caller gives: the wall clock on screen, the file frame's script (or match) time in an
 * export, never the wall clock there, so an export is the same whatever the machine's speed.
 * `MeterClock` makes a frame drawn again at the same time (an export frame re-rendered after a
 * load wait, a motion-blur frame's subframes) recompute the same step instead of stepping twice.
 */
import { contrastCurve, saturate, warmthGain, type FilmLookSettings } from './filmLook3d'

/** The output chain a frame is drawn through, from the scene's linear light to screen values. */
export interface ToneChain {
  /** The renderer's own exposure (the view's, `lighting.ts`). */
  exposure: number
  /** The grade pass's per-channel gain on screen values (`postFx3d.GRADE_GAIN`). */
  grade: readonly [number, number, number]
  /** The camera script's film look, resolved, or null for the default view. */
  film: FilmLookSettings | null
}

/** The share of the frame's (non-glowing) cells at or under the highlight level P. */
export const METER_PERCENTILE = 0.97
/** The ceiling never darkens a frame more than this (stops). */
export const CEILING_MAX_STOPS = 1.5
/**
 * Linear luminance of a white surface under the full sun: SUN_INTENSITY / pi x (1 + SKY_FILL_SHARE)
 * = 3.2 / pi x 1.25 (`lighting.ts`, the bloom threshold's own reasoning in `bloom3d.ts`). The
 * default view's slope there (about 15 code values per stop) is the detail floor.
 */
export const DETAIL_FLOOR_LUMINANCE = (3.2 / Math.PI) * 1.25
/** The ceiling's easing time constant, in ms of the clock it runs on. */
export const CEILING_TAU_MS = 250
/** A clock step longer than this (or backward) is a cut: the ceiling snaps to the frame's value. */
export const CEILING_SNAP_MS = 1000

/** The ceiling table's range: log2 of the highlight level P, and its step (stops). */
export const TABLE_LOG_MIN = -8
export const TABLE_LOG_MAX = 4
export const TABLE_STEP = 0.25
export const TABLE_SIZE = Math.round((TABLE_LOG_MAX - TABLE_LOG_MIN) / TABLE_STEP) + 1

const LUMA = [0.2126, 0.7152, 0.0722] as const
type Rgb = [number, number, number]

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1)

/** three's ACES fit (`tonemapping_pars_fragment`, r170) on a linear color already exposed. */
export function acesFilmic(c: readonly number[]): Rgb {
  const v = c.map((x) => x / 0.6)
  const a = [0.59719 * v[0] + 0.35458 * v[1] + 0.04823 * v[2], 0.076 * v[0] + 0.90834 * v[1] + 0.01566 * v[2], 0.0284 * v[0] + 0.13383 * v[1] + 0.83777 * v[2]]
  const f = a.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081))
  return [
    clamp01(1.60475 * f[0] - 0.53108 * f[1] - 0.07367 * f[2]),
    clamp01(-0.10208 * f[0] + 1.10813 * f[1] - 0.00605 * f[2]),
    clamp01(-0.00327 * f[0] - 0.07276 * f[1] + 1.07602 * f[2]),
  ]
}

/** three's AgX (`tonemapping_pars_fragment`, r170) on a linear color already exposed. */
export function agx(c: readonly number[]): Rgb {
  const m = (r: readonly number[][], v: readonly number[]) => r.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
  // Row-major forms of three's column-major matrices.
  const toRec2020 = [[0.6274, 0.3293, 0.0433], [0.0691, 0.9195, 0.0113], [0.0164, 0.088, 0.8956]]
  const inset = [[0.856627153315983, 0.0951212405381588, 0.0482516061458583], [0.137318972929847, 0.761241990602591, 0.101439036467562], [0.11189821299995, 0.0767994186031903, 0.811302368396859]]
  const outset = [[1.1271005818144368, -0.11060664309660323, -0.016493938717834573], [-0.1413297634984383, 1.157823702216272, -0.016493938717834257], [-0.14132976349843826, -0.11060664309660294, 1.2519364065950405]]
  const toSrgb = [[1.6605, -0.5876, -0.0728], [-0.1246, 1.1329, -0.0083], [-0.0182, -0.1006, 1.1187]]
  const minEv = -12.47393
  const maxEv = 4.026069
  let v = m(inset, m(toRec2020, c))
  v = v.map((x) => clamp01((Math.log2(Math.max(x, 1e-10)) - minEv) / (maxEv - minEv)))
  v = v.map((x) => {
    const x2 = x * x
    const x4 = x2 * x2
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232
  })
  v = m(outset, v).map((x) => Math.pow(Math.max(x, 0), 2.2))
  const s = m(toSrgb, v)
  return [clamp01(s[0]), clamp01(s[1]), clamp01(s[2])]
}

/** The sRGB transfer (three's `sRGBTransferOETF`). */
export function srgbEncode(x: number): number {
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 0.41666) - 0.055
}

/**
 * chainScreen: the screen color (0..1) the chain draws for a grey of linear luminance `v` (before
 * exposure): exposure (with the look's stops), ACES or AgX, sRGB, the grade, then the film pass
 * (warmth, film curve, saturation; the vignette and grain are position effects, left out).
 */
export function chainScreen(v: number, chain: ToneChain): Rgb {
  const film = chain.film
  const e = chain.exposure * (film ? Math.pow(2, film.exposure) : 1)
  const x = Math.max(v, 0) * e
  const tone = film?.tone === 'agx' ? agx([x, x, x]) : acesFilmic([x, x, x])
  const graded = tone.map((c, i) => srgbEncode(c) * chain.grade[i])
  if (!film) return graded.map(clamp01) as Rgb
  const w = warmthGain(film.warmth)
  const curved = graded.map((c, i) => contrastCurve(clamp01(c) * w[i], film.contrast)) as Rgb
  return saturate(curved, film.saturation).map(clamp01) as Rgb
}

/** chainLuma: the screen luma (code values, 0..255) the chain draws for linear luminance `v`. */
export function chainLuma(v: number, chain: ToneChain): number {
  const c = chainScreen(v, chain)
  return 255 * (LUMA[0] * c[0] + LUMA[1] * c[1] + LUMA[2] * c[2])
}

/** The half-width of `chainSlope`'s central difference, in stops. */
const SLOPE_HALF_STOP = 0.125

/** chainSlope: the chain's detail at `v`: screen luma code values per stop of light. */
export function chainSlope(v: number, chain: ToneChain): number {
  const k = Math.pow(2, SLOPE_HALF_STOP)
  return (chainLuma(v * k, chain) - chainLuma(v / k, chain)) / (2 * SLOPE_HALF_STOP)
}

/** steepestLuminance: the luminance where the chain's slope peaks (scanned at 1/16 stop from 2^-10 to 2^4). */
export function steepestLuminance(chain: ToneChain): number {
  let best = 0
  let at = 1
  for (let l = -10; l <= 4; l += 1 / 16) {
    const s = chainSlope(Math.pow(2, l), chain)
    if (s > best) {
      best = s
      at = Math.pow(2, l)
    }
  }
  return at
}

/** The darkening search's step, in stops. */
const SEARCH_STEP = 0.01

/**
 * ceilingStops: the ceiling (stops, 0 or negative) for a frame whose highlight level is `p`, drawn
 * through `chain`; `base` is the default view's chain (no film look). See the file header for the
 * rule. `steepest` (the chain's `steepestLuminance`) may be given to skip its scan.
 */
export function ceilingStops(p: number, chain: ToneChain, base: ToneChain, steepest = steepestLuminance(chain)): number {
  if (!(p > 0) || p <= steepest) return 0
  const floor = chainSlope(DETAIL_FLOOR_LUMINANCE, base)
  const need = chain.film ? Math.max(chainSlope(p, base), floor) : floor
  if (chainSlope(p, chain) >= need) return 0
  const lowest = Math.max(-CEILING_MAX_STOPS, Math.log2(steepest / p))
  for (let c = -SEARCH_STEP; c > lowest; c -= SEARCH_STEP) {
    if (chainSlope(p * Math.pow(2, c), chain) >= need) return c
  }
  return lowest
}

/**
 * ceilingTable: `ceilingStops` at every log2 level of the table's range (`TABLE_LOG_MIN` to
 * `TABLE_LOG_MAX`, step `TABLE_STEP`), which the meter's shader interpolates.
 */
export function ceilingTable(chain: ToneChain, base: ToneChain): Float32Array {
  const steepest = steepestLuminance(chain)
  const out = new Float32Array(TABLE_SIZE)
  for (let i = 0; i < TABLE_SIZE; i++) out[i] = ceilingStops(Math.pow(2, TABLE_LOG_MIN + i * TABLE_STEP), chain, base, steepest)
  return out
}

/** tableAt: the table's value at highlight level `p`, linearly interpolated as the shader does. */
export function tableAt(table: Float32Array, p: number): number {
  const u = Math.min(Math.max((Math.log2(Math.max(p, 1e-12)) - TABLE_LOG_MIN) / TABLE_STEP, 0), table.length - 1)
  const i0 = Math.floor(u)
  const i1 = Math.min(i0 + 1, table.length - 1)
  return table[i0] + (table[i1] - table[i0]) * (u - i0)
}

/** smoothingAlpha: the share of the way to the frame's value the ceiling moves in `dtMs`. */
export function smoothingAlpha(dtMs: number): number {
  if (!(dtMs > 0)) return 0
  return 1 - Math.exp(-dtMs / CEILING_TAU_MS)
}

/** One smoothing step: which state slot to read (null: snap to the frame's value), which to write, and the step's share. */
export interface MeterStep {
  read: 0 | 1 | null
  write: 0 | 1
  alpha: number
}

/**
 * MeterClock — which of the meter's two state slots each draw reads and writes. Slot `cur` holds
 * the ceiling at time `last`, the other the ceiling at `before` (the step before it).
 *  - A later time steps from `last`: read `cur`, write the other, which becomes `cur`.
 *  - The same time again (a re-render) redoes that step from `before`: read the other, write
 *    `cur`, with the same share; drawn twice, a frame gets the same ceiling.
 *  - The first draw, a time going back, or one more than `CEILING_SNAP_MS` later: snap (read
 *    nothing, the frame's own value), and a re-render at that time snaps again.
 */
export class MeterClock {
  private last = Number.NaN
  private before = Number.NaN
  private cur: 0 | 1 = 0

  /** reset: the next draw snaps (an export starts, the view changes). */
  reset(): void {
    this.last = Number.NaN
    this.before = Number.NaN
  }

  step(t: number): MeterStep {
    const other = (1 - this.cur) as 0 | 1
    if (Number.isFinite(this.last) && t === this.last) {
      if (!Number.isFinite(this.before)) return { read: null, write: this.cur, alpha: 1 }
      return { read: other, write: this.cur, alpha: smoothingAlpha(this.last - this.before) }
    }
    if (!Number.isFinite(t) || !Number.isFinite(this.last) || t < this.last || t - this.last > CEILING_SNAP_MS) {
      this.before = Number.NaN
      this.last = t
      this.cur = other
      return { read: null, write: other, alpha: 1 }
    }
    const alpha = smoothingAlpha(t - this.last)
    this.before = this.last
    this.last = t
    const read = this.cur
    this.cur = other
    return { read, write: other, alpha }
  }

  /** The slot holding the ceiling of the last draw. */
  get current(): 0 | 1 { return this.cur }
}
