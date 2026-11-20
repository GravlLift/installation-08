// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * filmLook3d.ts — THE FILM LOOK of a camera script (`look`, docs/design/camera-scripts.md): an
 * opt-in lens and film response for broadcast shots. It never adds light: it changes how the
 * light the view already renders is developed (tone curve, exposure, bloom strength, grade,
 * vignette, grain). Without `look` the compositor draws the game-matched default, untouched.
 *
 * Pure part: the type, its validation (`parseFilmLook`), its defaults (`resolveFilmLook`), and the
 * grade math the film pass runs (`FILM_FRAGMENT`), mirrored in TypeScript so it can be tested
 * (`contrastCurve`, `saturate`, `warmthGain`, `vignetteAt`, `grainNoise`, `filmGrade`).
 */

export interface FilmLook {
  preset: 'film'
  /** Stops on top of the view's exposure. */
  exposure?: number
  /** Slope of the S-curve at mid grey; 1 leaves contrast as the tone curve gives it. */
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

/** A film look with every tunable resolved. */
export type FilmLookSettings = Required<Omit<FilmLook, 'preset'>>
type Tunable = keyof FilmLookSettings

/** Each tunable's accepted range, inclusive. */
export const FILM_LOOK_RANGES: Readonly<Record<Tunable, readonly [number, number]>> = {
  exposure: [-3, 3],
  contrast: [0.5, 2],
  saturation: [0, 2],
  vignette: [0, 1],
  grain: [0, 1],
  bloom: [0, 2],
  warmth: [-1, 1],
}

/** The 'film' preset: a touch more contrast and color than the tone curve alone, a soft vignette, fine grain, a stronger glow, slightly warm. */
export const FILM_LOOK_DEFAULTS: Readonly<FilmLookSettings> = {
  exposure: 0,
  contrast: 1.2,
  saturation: 1.1,
  vignette: 0.3,
  grain: 0.25,
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

/** resolveFilmLook fills the tunables a look leaves out with the preset's defaults. */
export function resolveFilmLook(look: FilmLook): FilmLookSettings {
  const out = { ...FILM_LOOK_DEFAULTS }
  for (const name of TUNABLES) {
    const v = look[name]
    if (v !== undefined) out[name] = v
  }
  return out
}

/** Mid grey (linear 0.18) in screen (sRGB-encoded) values: the contrast curve's pivot. */
export const FILM_PIVOT = 0.4614
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
 * contrastCurve: an S-curve on a screen value in [0, 1] through 0, `FILM_PIVOT` and 1, with slope
 * `k` at the pivot: power curves on each side, so it is monotonic and never clips.
 */
export function contrastCurve(x: number, k: number): number {
  const c = Math.min(Math.max(x, 0), 1)
  const p = FILM_PIVOT
  return c <= p ? p * Math.pow(c / p, k) : 1 - (1 - p) * Math.pow((1 - c) / (1 - p), k)
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

/** pcg: the PCG integer hash (32 bits), as the film pass's shader runs it on unsigned integers. */
export function pcg(v: number): number {
  const state = (Math.imul(v >>> 0, 747796405) + 2891336453) >>> 0
  const word = Math.imul(((state >>> ((state >>> 28) + 4)) ^ state) >>> 0, 277803737) >>> 0
  return ((word >>> 22) ^ word) >>> 0
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

/** grainNoise: the grain at pixel (x, y) for seed `seed`, in [-1, 1). */
export function grainNoise(x: number, y: number, seed: number): number {
  const h = pcg((x >>> 0) + pcg((y >>> 0) + pcg(seed >>> 0)))
  return (h / 4294967296) * 2 - 1
}

/** grainWeight: grain shows most in the mid tones, a quarter of it in black and white. */
export function grainWeight(l: number): number {
  return 0.25 + 3 * l * (1 - l)
}

/**
 * filmGrade: the film pass on one screen pixel, exactly as `FILM_FRAGMENT` runs it: warmth,
 * contrast per channel, saturation, vignette at (u, v), then grain at pixel (x, y).
 */
export function filmGrade(
  rgb: readonly [number, number, number],
  at: { u: number; v: number; x: number; y: number },
  look: FilmLookSettings,
  seed: number,
): [number, number, number] {
  const w = warmthGain(look.warmth)
  const c = rgb.map((v, i) => contrastCurve(Math.min(Math.max(v, 0), 1) * w[i], look.contrast)) as [number, number, number]
  const s = saturate(c, look.saturation)
  const g = vignetteAt(at.u, at.v, look.vignette)
  const vig = s.map((v) => v * g) as [number, number, number]
  const n = look.grain * GRAIN_AMPLITUDE * grainNoise(at.x, at.y, seed) * grainWeight(luma(vig))
  return [vig[0] + n, vig[1] + n, vig[2] + n]
}

/** The film pass's shader: `filmGrade` on every pixel (screen values in, screen values out). */
export const FILM_FRAGMENT = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec3 uWarmth;
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform float uGrain;
uniform float uSeed;
varying vec2 vUv;
const float PIVOT = ${FILM_PIVOT.toFixed(4)};
const vec3 LUMA = vec3(${LUMA.map((v) => v.toFixed(4)).join(', ')});
float contrastCurve(float x) {
  float c = clamp(x, 0.0, 1.0);
  return c <= PIVOT ? PIVOT * pow(c / PIVOT, uContrast) : 1.0 - (1.0 - PIVOT) * pow((1.0 - c) / (1.0 - PIVOT), uContrast);
}
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}
void main() {
  vec4 src = texture2D(tDiffuse, vUv);
  vec3 c = clamp(src.rgb, 0.0, 1.0) * uWarmth;
  c = vec3(contrastCurve(c.r), contrastCurve(c.g), contrastCurve(c.b));
  float l = dot(c, LUMA);
  c = max(vec3(l) + (c - vec3(l)) * uSaturation, 0.0);
  float d = length((vUv - 0.5) * 2.0) * 0.70710678;
  c *= 1.0 - uVignette * smoothstep(${VIGNETTE_START.toFixed(4)}, ${VIGNETTE_END.toFixed(4)}, d);
  uvec2 p = uvec2(gl_FragCoord.xy);
  uint h = pcg(p.x + pcg(p.y + pcg(uint(uSeed))));
  float n = float(h) / 4294967296.0 * 2.0 - 1.0;
  l = dot(c, LUMA);
  c += uGrain * ${GRAIN_AMPLITUDE.toFixed(4)} * n * (0.25 + 3.0 * l * (1.0 - l));
  gl_FragColor = vec4(c, src.a);
}
`
