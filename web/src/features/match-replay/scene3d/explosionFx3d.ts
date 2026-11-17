// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * explosionFx3d.ts — AN EXPLOSION AT AN AGE: what the 3D view draws of it, a pure function of
 * the age (seconds since the published detonation) and a seed.
 *
 * Replay is browsed forward as much as backward: no particle is simulated frame to frame. Each
 * spark/billow has its own draws (direction, speed, delay, duration) fixed by the explosion's
 * seed and its own rank, and its place is computed in closed form from the age: the same frame
 * renders the same explosion.
 *
 * The staging follows the game (a Halo Infinite frag): everything plays out in under a second.
 * A one- to two-frame white flash, a fireball MADE OF SEVERAL OVERLAPPING BILLOWS (orange,
 * yellow-white hot spots, dark holes between them) drifting apart a little as they rise, a
 * spray of white sparks that fly out and fall back, then a smoke veil gone before 0.8 s. Plasma:
 * flash and energy spray in the weapon's tint, no smoke. Shard (Spike): straight, fast needles.
 * The fireball stays under the damage radius (`BLAST_RADIUS` from `flights3d`).
 *
 * Halo world units (1 u = 3.048 m), three axes (Y up). Linear, premultiplied colors: `r, g, b`
 * is the emitted light, `a` what the spark/billow occludes behind it (0: pure glow).
 */
import type { FxTint } from '../layers/fxInk'

/** A detonation's three stagings. */
export type BlastStyle = 'fire' | 'plasma' | 'shard'

/** blastStyleOf: a detonation's staging, from the nature of its discharge (`fxInk`). */
export function blastStyleOf(tint: FxTint): BlastStyle {
  if (tint === 'needle') return 'shard'
  if (tint === 'plasma_cool' || tint === 'plasma_green' || tint === 'plasma_hot' || tint === 'electric' || tint === 'forerunner') return 'plasma'
  return 'fire'
}

/** A linear color (a `THREE.Color` works). */
export interface Rgb {
  r: number
  g: number
  b: number
}

/** An explosion's inks: the shared incandescent core and the discharge's tint. */
export interface BlastInk {
  core: Rgb
  tint: Rgb
}

/** What receives a frame's sparks/billows (the render buffers, or a list in tests). */
export interface BlastSink {
  /** A round spark/billow: offset from the center (u), radius (u), emitted light, opacity. */
  sprite(x: number, y: number, z: number, radius: number, r: number, g: number, b: number, a: number): void
  /** A streak: from (x0, y0, z0) to (x1, y1, z1), offsets from the center (u), emitted light. */
  streak(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, g: number, b: number): void
}

/** The end of every explosion (s): beyond it, nothing is drawn. */
export const BLAST_END_SECONDS = 0.8
/** Sparks' gravity (u/s^2): 9.8 m/s^2. */
const GRAVITY = 3.2
/** The white flash's duration (s): one to two frames on screen. */
export const BLAST_FLASH_SECONDS = 0.06
/** How long a spark's streak lasts (s): the length of its trail. */
const STREAK_SECONDS = 0.03

interface StyleSpec {
  flashRadius: number
  flashGain: number
  billows: number
  /** A billow's radius (u) and its spread. */
  billowRadius: [number, number]
  /** A billow's distance from the center at the end of its life (u). */
  billowReach: [number, number]
  billowLife: [number, number]
  /** A billow's peak opacity: a fireball occludes what's behind it, plasma doesn't. */
  billowCover: number
  billowGain: number
  sparks: number
  sparkSpeed: [number, number]
  sparkLife: [number, number]
  sparkGravity: number
  /** A spark's streak, as a multiple of `STREAK_SECONDS`. */
  sparkTrail: number
  smoke: number
  light: number
  lightSeconds: number
}

const SPECS: Record<BlastStyle, StyleSpec> = {
  fire: {
    flashRadius: 0.9, flashGain: 4, billows: 12, billowRadius: [0.36, 0.5], billowReach: [0.15, 0.3],
    billowLife: [0.42, 0.66], billowCover: 0.95, billowGain: 1.1, sparks: 30, sparkSpeed: [5, 12],
    sparkLife: [0.25, 0.6], sparkGravity: 1, sparkTrail: 1, smoke: 4, light: 24, lightSeconds: 0.3,
  },
  plasma: {
    flashRadius: 0.8, flashGain: 4, billows: 7, billowRadius: [0.2, 0.32], billowReach: [0.15, 0.32],
    billowLife: [0.22, 0.38], billowCover: 0.12, billowGain: 2.6, sparks: 22, sparkSpeed: [6, 14],
    sparkLife: [0.15, 0.35], sparkGravity: 0.25, sparkTrail: 1.5, smoke: 0, light: 18, lightSeconds: 0.25,
  },
  shard: {
    flashRadius: 0.5, flashGain: 3, billows: 3, billowRadius: [0.15, 0.22], billowReach: [0.1, 0.2],
    billowLife: [0.2, 0.3], billowCover: 0.1, billowGain: 1.6, sparks: 26, sparkSpeed: [10, 16],
    sparkLife: [0.2, 0.35], sparkGravity: 0, sparkTrail: 3, smoke: 0, light: 10, lightSeconds: 0.2,
  },
}

/** blastLight: the strength of the detonation's light at `age` (full at the start, quickly off). */
export function blastLight(style: BlastStyle, age: number): number {
  const s = SPECS[style]
  if (age < 0 || age >= s.lightSeconds) return 0
  const u = 1 - age / s.lightSeconds
  return s.light * u * u
}

/**
 * rand: a draw in [0, 1) specific to seed `seed`, spark/billow `i` and draw `k` (integer hash):
 * the same explosion always draws the same numbers, with no state.
 */
export function rand(seed: number, i: number, k: number): number {
  let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35) ^ Math.imul(k + 1, 0x27d4eb2f)
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

function between(range: [number, number], t: number): number {
  return range[0] + (range[1] - range[0]) * t
}

/** A drawn direction, mostly upward (`up`: minimum vertical share), unit length. */
function direction(seed: number, i: number, k: number, up: number): [number, number, number] {
  const a = rand(seed, i, k) * Math.PI * 2
  const y = up + (1 - up) * rand(seed, i, k + 1)
  const h = Math.sqrt(Math.max(0, 1 - y * y))
  return [h * Math.cos(a), y, h * Math.sin(a)]
}

/**
 * blastAt places into `sink` the sparks/billows of an explosion of style `style`, `age` seconds
 * after the detonation, seed `seed`, inks `ink`. Nothing before the detonation nor after
 * `BLAST_END_SECONDS`.
 */
export function blastAt(style: BlastStyle, age: number, seed: number, ink: BlastInk, sink: BlastSink): void {
  if (age < 0 || age >= BLAST_END_SECONDS) return
  const s = SPECS[style]
  if (age < BLAST_FLASH_SECONDS) {
    const k = 1 - age / BLAST_FLASH_SECONDS
    const g = s.flashGain * k * k
    sink.sprite(0, 0.1, 0, s.flashRadius * (0.7 + 0.3 * (1 - k)), ink.core.r * g, ink.core.g * g, ink.core.b * g, 0)
  }
  billows(s, age, seed, ink, sink)
  sparks(s, age, seed, ink, sink)
  smoke(s, age, seed, ink, sink)
}

/**
 * billows: the fireball's billows. Each is born near the center, drifts apart as it rises (fast
 * expansion then slow), grows, shifts from hot white to the tint then to dark red and fades
 * out; their drawn offsets make a lumpy ball, never a sphere.
 */
function billows(s: StyleSpec, age: number, seed: number, ink: BlastInk, sink: BlastSink): void {
  for (let i = 0; i < s.billows; i++) {
    const delay = 0.025 * rand(seed, i, 0)
    const life = between(s.billowLife, rand(seed, i, 1))
    const u = (age - delay) / life
    if (u < 0 || u >= 1) continue
    const [dx, dy, dz] = direction(seed, i, 2, 0.15)
    // Expansion: the ball reaches almost full size by the first third of its life.
    const ease = 1 - (1 - Math.min(1, u * 3)) ** 3
    const reach = 0.06 + between(s.billowReach, rand(seed, i, 4)) * ease
    const radius = between(s.billowRadius, rand(seed, i, 5)) * (0.7 + 0.45 * ease)
    // Heat: hot white at the start, the tint in the middle, dark red (green removed) at the end;
    // some billows stay hotter (the ball's yellow-white hot spots), others darker (the ball's
    // holes).
    const heat = Math.min(1, Math.max(0, 1 - u * 6 + 1.2 * (rand(seed, i, 7) - 0.5)))
    // Billows overlap: their color converges toward light / opacity, hence a modest gain (an
    // orange ball with body, not a saturated white).
    // Light fades faster than body: the end of a billow is dark, never a saturated red disc.
    const fade = (1 - u) ** 2.2 * s.billowGain * (0.75 + 0.5 * rand(seed, i, 6))
    const cool = 1 - 0.4 * Math.min(1, u * 1.6)
    const r = (ink.tint.r + (ink.core.r - ink.tint.r) * heat) * fade
    const g = (ink.tint.g * cool * cool + (ink.core.g - ink.tint.g) * heat) * fade
    const b = (ink.tint.b * cool + (ink.core.b - ink.tint.b) * heat) * fade
    sink.sprite(dx * reach, dy * reach + 0.15 * u * life, dz * reach, radius, r, g, b, s.billowCover * (1 - u) ** 1.6)
  }
}

/** sparks: the spray of sparks, each on a ballistic flight from the center, trail included. */
function sparks(s: StyleSpec, age: number, seed: number, ink: BlastInk, sink: BlastSink): void {
  for (let i = 0; i < s.sparks; i++) {
    const t = age - 0.02 * rand(seed, 100 + i, 0)
    const life = between(s.sparkLife, rand(seed, 100 + i, 1))
    if (t < 0 || t >= life) continue
    const [dx, dy, dz] = direction(seed, 100 + i, 2, -0.25)
    const v = between(s.sparkSpeed, rand(seed, 100 + i, 4))
    const g = GRAVITY * s.sparkGravity
    const t0 = Math.max(0, t - STREAK_SECONDS * s.sparkTrail)
    const at = (tt: number) => [dx * v * tt, dy * v * tt - 0.5 * g * tt * tt, dz * v * tt] as const
    const [x0, y0, z0] = at(t0)
    const [x1, y1, z1] = at(t)
    const k = 1 - t / life
    const glow = 2.5 * k
    const hot = k * k
    sink.streak(
      x0, y0, z0, x1, y1, z1,
      (ink.tint.r + (ink.core.r - ink.tint.r) * hot) * glow,
      (ink.tint.g + (ink.core.g - ink.tint.g) * hot) * glow,
      (ink.tint.b + (ink.core.b - ink.tint.b) * hot) * glow,
    )
  }
}

/** smoke: a veil of gray smoke that rises, widens, and is gone before `BLAST_END_SECONDS`. */
function smoke(s: StyleSpec, age: number, seed: number, ink: BlastInk, sink: BlastSink): void {
  for (let i = 0; i < s.smoke; i++) {
    const start = 0.1 + 0.06 * rand(seed, 200 + i, 0)
    const life = 0.5 + 0.1 * rand(seed, 200 + i, 1)
    const u = (age - start) / life
    if (u < 0 || u >= 1) continue
    const [dx, dy, dz] = direction(seed, 200 + i, 2, 0.3)
    const spread = 0.25 + 0.2 * u
    const shade = 0.06
    const cover = 0.28 * Math.sin(Math.PI * u)
    sink.sprite(
      dx * spread, dy * spread + 0.4 * u, dz * spread, 0.35 + 0.35 * u,
      ink.core.r * shade * cover, ink.core.g * shade * cover, ink.core.b * shade * cover, cover,
    )
  }
}
