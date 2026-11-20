// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * filmLook3d.ts — THE FILM LOOK of a camera script (`look`, docs/design/camera-scripts.md): an
 * opt-in lens and film response for broadcast shots. It never adds light: it changes how the
 * light the view already renders is developed (exposure, bloom strength, grade, vignette, grain).
 * Without `look` the compositor draws the game-matched default, untouched.
 *
 * The base is the view's own tone curve (ACES, game-matched); the film response is drawn on top
 * of it by the film pass: a toe that deepens the blacks, a mid contrast slope, a highlight
 * shoulder that rolls into white, saturation, warmth, a vignette and grain. AgX is there only on
 * request (`tone: 'agx'`).
 *
 * Pure part: the type, its validation (`parseFilmLook`), its defaults (`resolveFilmLook`), and the
 * grade math the film pass runs (`FILM_FRAGMENT`), mirrored in TypeScript so it can be tested
 * (`contrastCurve`, `saturate`, `warmthGain`, `vignetteAt`, `grainNoise`, `filmGrade`).
 */

export type FilmTone = 'aces' | 'agx'
export const FILM_TONES: readonly FilmTone[] = ['aces', 'agx']

export interface FilmLook {
  preset: 'film'
  /** The tone curve under the film response: the view's ACES (default) or AgX. */
  tone?: FilmTone
  /** Stops on top of the view's exposure. */
  exposure?: number
  /** Slope of the film curve at mid grey; 1 keeps the mid tones' contrast. Above 1 the toe also deepens the blacks. */
  contrast?: number
  /** 1 leaves saturation as is, 0 is black and white. */
  saturation?: number
  /** Darkening of the frame's corners, 0 (none) to 1 (black corners). */
  vignette?: number
  /** Film grain strength, 0 (none) to 1 (heavy). */
  grain?: number
  /** Bloom halo gain (the default view's is `BLOOM_STRENGTH`, 0.3). */
  bloom?: number
  /** Color balance, -1 (cool) to 1 (warm). */
  warmth?: number
}

/** A film look with every field resolved. */
export type FilmLookSettings = Required<Omit<FilmLook, 'preset'>>
type Tunable = Exclude<keyof FilmLookSettings, 'tone'>

/** Each numeric tunable's accepted range, inclusive. */
export const FILM_LOOK_RANGES: Readonly<Record<Tunable, readonly [number, number]>> = {
  exposure: [-3, 3],
  contrast: [0.5, 2],
  saturation: [0, 2],
  vignette: [0, 1],
  grain: [0, 1],
  bloom: [0, 2],
  warmth: [-1, 1],
}

/**
 * The 'film' preset, on the view's ACES: deeper blacks and punchier mids (contrast 1.35 at mid
 * grey), richer color, corners 30 % darker, fine grain, a stronger glow, slightly warm.
 */
export const FILM_LOOK_DEFAULTS: Readonly<FilmLookSettings> = {
  tone: 'aces',
  exposure: 0,
  contrast: 1.35,
  saturation: 1.2,
  vignette: 0.3,
  grain: 0.2,
  bloom: 0.5,
  warmth: 0.15,
}

const TUNABLES = Object.keys(FILM_LOOK_RANGES) as Tunable[]

/** Validates a raw `look`; returns a clean copy with only the known fields, or a short reason. */
export function parseFilmLook(raw: unknown): { look: FilmLook } | { error: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { error: 'look is not an object' }
  const r = raw as Record<string, unknown>
  if (r.preset !== 'film') return { error: "look.preset must be 'film'" }
  const look: FilmLook = { preset: 'film' }
  if (r.tone !== undefined) {
    if (typeof r.tone !== 'string' || !FILM_TONES.includes(r.tone as FilmTone)) {
      return { error: `look.tone must be one of ${FILM_TONES.join(', ')}` }
    }
    look.tone = r.tone as FilmTone
  }
  for (const name of TUNABLES) {
    const v = r[name]
    if (v === undefined) continue
    const [min, max] = FILM_LOOK_RANGES[name]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
      return { error: `look.${name} must be a finite number in [${min}, ${max}]` }
    }
    look[name] = v
  }
  return { look }
}

/** resolveFilmLook fills the fields a look leaves out with the preset's defaults. */
export function resolveFilmLook(look: FilmLook): FilmLookSettings {
  const out = { ...FILM_LOOK_DEFAULTS }
  if (look.tone !== undefined) out.tone = look.tone
  for (const name of TUNABLES) {
    const v = look[name]
    if (v !== undefined) out[name] = v
  }
  return out
}

/** Mid grey (linear 0.18) in screen (sRGB-encoded) values: the film curve's pivot. */
export const FILM_PIVOT = 0.4614
/** The film curve's slope at white: under 1, the highlights roll into white instead of clipping. */
export const FILM_SHOULDER = 0.5
/** Rec. 709 luma weights. */
const LUMA = [0.2126, 0.7152, 0.0722] as const
/** Red and blue gain per unit of warmth. */
export const WARMTH_SHIFT = 0.08
/** Distance from the center (0) toward the corners (1) where the vignette starts, and where it is full. */
export const VIGNETTE_START = 0.35
export const VIGNETTE_END = 1
/** Grain amplitude at strength 1, in screen values, at mid tones. */
export const GRAIN_AMPLITUDE = 0.08

/**
 * contrastCurve: the film curve on a screen value in [0, 1], through 0, `FILM_PIVOT` and 1 with
 * slope `k` at the pivot. Below it a power toe (`k` above 1 presses the blacks down, slope 0 at
 * black); above it a cubic shoulder from slope `k` to slope `s` at white. Monotonic for `k` up
 * to 2 and `s` in [0, 1]; the identity for k = s = 1.
 */
export function contrastCurve(x: number, k: number, s: number = FILM_SHOULDER): number {
  const c = Math.min(Math.max(x, 0), 1)
  const p = FILM_PIVOT
  if (c <= p) return p * Math.pow(c / p, k)
  const t = (c - p) / (1 - p)
  const t2 = t * t
  const t3 = t2 * t
  return p + (1 - p) * (k * (t3 - 2 * t2 + t) + (3 * t2 - 2 * t3) + s * (t3 - t2))
}

function luma(rgb: readonly number[]): number {
  return LUMA[0] * rgb[0] + LUMA[1] * rgb[1] + LUMA[2] * rgb[2]
}

/** saturate scales a color's distance from its own luma by `s` (never below zero). */
export function saturate(rgb: readonly [number, number, number], s: number): [number, number, number] {
  const l = luma(rgb)
  return [Math.max(l + (rgb[0] - l) * s, 0), Math.max(l + (rgb[1] - l) * s, 0), Math.max(l + (rgb[2] - l) * s, 0)]
}

/** warmthGain: the per-channel gain of a warmth, red up and blue down for warm. */
export function warmthGain(w: number): [number, number, number] {
  return [1 + WARMTH_SHIFT * w, 1, 1 - WARMTH_SHIFT * w]
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1)
  return t * t * (3 - 2 * t)
}

/**
 * vignetteAt: the gain at frame point (u, v) in [0, 1]: 1 at the center, falling softly to
 * 1 - `strength` in the corners. Measured in frame units, so its shape follows the frame (an
 * ellipse on a wide frame).
 */
export function vignetteAt(u: number, v: number, strength: number): number {
  const d = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2) * Math.SQRT1_2
  return 1 - strength * smoothstep(VIGNETTE_START, VIGNETTE_END, d)
}

/**
 * filmSeed: the grain's seed for a frame drawn at script ms `sMs`: identical frames get identical
 * grain (the export is reproducible, a paused frame does not swim), each new frame new grain. An
 * integer under 2^24, exact in the shader's float uniform.
 */
export function filmSeed(sMs: number): number {
  if (!Number.isFinite(sMs)) return 0
  return ((Math.round(sMs) % 16777216) + 16777216) % 16777216
}

/** The seed's offset of the grain's pixel grid: two integers under 4096 (exact, and small enough for the hash's precision). */
export function seedOffset(seed: number): [number, number] {
  return [seed % 4096, Math.floor(seed / 4096) % 4096]
}

function fract(x: number): number {
  return x - Math.floor(x)
}

/** hash12: a float-only hash of a 2D point to [0, 1) (Dave Hoskins' "hash without sine"), as the film pass runs it. */
export function hash12(x: number, y: number): number {
  let a = fract(x * 0.1031)
  let b = fract(y * 0.1031)
  let c = fract(x * 0.1031)
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33)
  a += d
  b += d
  c += d
  return fract((a + b) * c)
}

/** grainNoise: the grain at pixel (x, y) for seed `seed`, in [-1, 1). */
export function grainNoise(x: number, y: number, seed: number): number {
  const [ox, oy] = seedOffset(seed)
  return hash12(Math.floor(x) + ox, Math.floor(y) + oy) * 2 - 1
}

/** grainWeight: grain shows most in the mid tones, a quarter of it in black and white. */
export function grainWeight(l: number): number {
  return 0.25 + 3 * l * (1 - l)
}

/**
 * filmGrade: the film pass on one screen pixel, the same math as `FILM_FRAGMENT`: warmth, the
 * film curve per channel, saturation, vignette at (u, v), then grain at pixel (x, y).
 */
export function filmGrade(
  rgb: readonly [number, number, number],
  at: { u: number; v: number; x: number; y: number },
  look: FilmLookSettings,
  seed: number,
  shoulder: number = FILM_SHOULDER,
): [number, number, number] {
  const w = warmthGain(look.warmth)
  const c = rgb.map((v, i) => contrastCurve(Math.min(Math.max(v, 0), 1) * w[i], look.contrast, shoulder)) as [number, number, number]
  const s = saturate(c, look.saturation)
  const g = vignetteAt(at.u, at.v, look.vignette)
  const vig = s.map((v) => v * g) as [number, number, number]
  const n = look.grain * GRAIN_AMPLITUDE * grainNoise(at.x, at.y, seed) * grainWeight(luma(vig))
  return [vig[0] + n, vig[1] + n, vig[2] + n]
}

const f = (v: number) => v.toFixed(4)

/** The film pass's shader: `filmGrade` on every pixel (screen values in, screen values out). Floats only. */
export const FILM_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 uWarmth;
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform float uGrain;
uniform vec2 uSeedOffset;
varying vec2 vUv;
const float PIVOT = ${f(FILM_PIVOT)};
const float SHOULDER = ${f(FILM_SHOULDER)};
const vec3 LUMA = vec3(${LUMA.map(f).join(', ')});
float filmCurve(float x) {
  float c = clamp(x, 0.0, 1.0);
  if (c <= PIVOT) return PIVOT * pow(c / PIVOT, uContrast);
  float t = (c - PIVOT) / (1.0 - PIVOT);
  float t2 = t * t;
  float t3 = t2 * t;
  return PIVOT + (1.0 - PIVOT) * (uContrast * (t3 - 2.0 * t2 + t) + (3.0 * t2 - 2.0 * t3) + SHOULDER * (t3 - t2));
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
void main() {
  vec4 src = texture2D(tDiffuse, vUv);
  vec3 c = clamp(src.rgb, 0.0, 1.0) * uWarmth;
  c = vec3(filmCurve(c.r), filmCurve(c.g), filmCurve(c.b));
  float l = dot(c, LUMA);
  c = max(vec3(l) + (c - vec3(l)) * uSaturation, vec3(0.0));
  float d = length((vUv - 0.5) * 2.0) * 0.70710678;
  c *= 1.0 - uVignette * smoothstep(${f(VIGNETTE_START)}, ${f(VIGNETTE_END)}, d);
  float n = hash12(floor(gl_FragCoord.xy) + uSeedOffset) * 2.0 - 1.0;
  l = dot(c, LUMA);
  c += vec3(uGrain * ${f(GRAIN_AMPLITUDE)} * n * (0.25 + 3.0 * l * (1.0 - l)));
  gl_FragColor = vec4(c, src.a);
}
`
