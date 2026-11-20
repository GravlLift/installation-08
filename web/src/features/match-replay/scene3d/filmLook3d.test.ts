// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { parseCameraScript } from './cameraScript3d'
import {
  contrastCurve,
  FILM_FRAGMENT,
  FILM_LOOK_DEFAULTS,
  FILM_LOOK_RANGES,
  FILM_PIVOT,
  FILM_SHOULDER,
  filmGrade,
  filmSeed,
  grainNoise,
  hash12,
  parseFilmLook,
  resolveFilmLook,
  saturate,
  seedOffset,
  vignetteAt,
  warmthGain,
  type FilmLookSettings,
} from './filmLook3d'

const KEY = { t: 0, pos: { at: 'world', point: [0, 0, 0] }, look: { at: 'world', point: [1, 0, 0] } }
const script = (extra: Record<string, unknown> = {}) => ({ version: 1, matchId: 'm', name: 'shot', keys: [KEY], ...extra })

/** Every tunable neutral: the film pass leaves a pixel as it is. */
const NEUTRAL: FilmLookSettings = { tone: 'aces', exposure: 0, contrast: 1, saturation: 1, vignette: 0, grain: 0, bloom: 0, warmth: 0 }

describe('parseFilmLook', () => {
  it('accepts a full look and returns a clean copy without unknown fields', () => {
    const raw = { preset: 'film', tone: 'agx', exposure: -0.5, contrast: 1.3, saturation: 0.9, vignette: 0.4, grain: 0.1, bloom: 1, warmth: -0.2, lut: 'x' }
    const r = parseFilmLook(raw)
    expect(r).toEqual({ look: { preset: 'film', tone: 'agx', exposure: -0.5, contrast: 1.3, saturation: 0.9, vignette: 0.4, grain: 0.1, bloom: 1, warmth: -0.2 } })
  })

  it("accepts tone 'aces' or 'agx' and rejects anything else", () => {
    expect(parseFilmLook({ preset: 'film', tone: 'aces' })).toEqual({ look: { preset: 'film', tone: 'aces' } })
    for (const tone of ['neutral', 1, null, 'ACES']) {
      expect(parseFilmLook({ preset: 'film', tone })).toEqual({ error: 'look.tone must be one of aces, agx' })
    }
  })

  it('accepts the preset alone, leaving the tunables out (defaults apply at draw time)', () => {
    expect(parseFilmLook({ preset: 'film' })).toEqual({ look: { preset: 'film' } })
  })

  it('accepts each range end', () => {
    for (const [name, [min, max]] of Object.entries(FILM_LOOK_RANGES)) {
      expect(parseFilmLook({ preset: 'film', [name]: min })).toEqual({ look: { preset: 'film', [name]: min } })
      expect(parseFilmLook({ preset: 'film', [name]: max })).toEqual({ look: { preset: 'film', [name]: max } })
    }
  })

  it('rejects a missing or unknown preset, a non-object, and out-of-range or non-numeric values', () => {
    expect(parseFilmLook(null)).toEqual({ error: 'look is not an object' })
    expect(parseFilmLook([])).toEqual({ error: 'look is not an object' })
    expect(parseFilmLook('film')).toEqual({ error: 'look is not an object' })
    expect(parseFilmLook({})).toEqual({ error: "look.preset must be 'film'" })
    expect(parseFilmLook({ preset: 'noir' })).toEqual({ error: "look.preset must be 'film'" })
    for (const [name, [min, max]] of Object.entries(FILM_LOOK_RANGES)) {
      const error = `look.${name} must be a finite number in [${min}, ${max}]`
      expect(parseFilmLook({ preset: 'film', [name]: min - 0.01 })).toEqual({ error })
      expect(parseFilmLook({ preset: 'film', [name]: max + 0.01 })).toEqual({ error })
      expect(parseFilmLook({ preset: 'film', [name]: Number.NaN })).toEqual({ error })
      expect(parseFilmLook({ preset: 'film', [name]: Number.POSITIVE_INFINITY })).toEqual({ error })
      expect(parseFilmLook({ preset: 'film', [name]: '1' })).toEqual({ error })
    }
  })

  it('the defaults sit inside their ranges', () => {
    expect(FILM_LOOK_DEFAULTS.tone).toBe('aces') // the view's game-matched curve is the base
    for (const [name, [min, max]] of Object.entries(FILM_LOOK_RANGES)) {
      const v = FILM_LOOK_DEFAULTS[name as keyof typeof FILM_LOOK_RANGES]
      expect(v).toBeGreaterThanOrEqual(min)
      expect(v).toBeLessThanOrEqual(max)
    }
  })
})

describe('parseCameraScript — look', () => {
  it('keeps a valid look as a clean copy', () => {
    const r = parseCameraScript(script({ look: { preset: 'film', grain: 0.5, extra: true } }))
    expect(r.ok && r.script.look).toEqual({ preset: 'film', grain: 0.5 })
  })

  it('without look, the script has no look field (the default look)', () => {
    const r = parseCameraScript(script())
    expect(r.ok).toBe(true)
    expect(r.ok && 'look' in r.script).toBe(false)
  })

  it('rejects an invalid look with its reason', () => {
    expect(parseCameraScript(script({ look: { preset: 'film', vignette: 2 } }))).toEqual({ ok: false, error: 'look.vignette must be a finite number in [0, 1]' })
    expect(parseCameraScript(script({ look: { exposure: 1 } }))).toEqual({ ok: false, error: "look.preset must be 'film'" })
  })
})

describe('resolveFilmLook', () => {
  it("fills the tunables a look leaves out with the 'film' defaults", () => {
    expect(resolveFilmLook({ preset: 'film' })).toEqual(FILM_LOOK_DEFAULTS)
    expect(resolveFilmLook({ preset: 'film', grain: 0, exposure: 0.5 })).toEqual({ ...FILM_LOOK_DEFAULTS, grain: 0, exposure: 0.5 })
  })
})

describe('the film grade math', () => {
  it('contrastCurve maps 0 to 0, 1 to 1 and the pivot to itself, and is monotonic over the whole range of contrast', () => {
    for (const s of [0, FILM_SHOULDER, 1]) {
      for (const k of [0.5, 0.8, 1, 1.2, 1.35, 2]) {
        expect(contrastCurve(0, k, s)).toBe(0)
        expect(contrastCurve(1, k, s)).toBeCloseTo(1, 12)
        expect(contrastCurve(FILM_PIVOT, k, s)).toBeCloseTo(FILM_PIVOT, 12)
        let prev = -1
        for (let i = 0; i <= 1000; i++) {
          const y = contrastCurve(i / 1000, k, s)
          expect(y).toBeGreaterThanOrEqual(prev)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(y).toBeLessThanOrEqual(1 + 1e-12)
          prev = y
        }
      }
    }
    for (let i = 0; i <= 20; i++) expect(contrastCurve(i / 20, 1, 1)).toBeCloseTo(i / 20, 12)
    // Out-of-range input is clamped.
    expect(contrastCurve(-1, 1.5)).toBe(0)
    expect(contrastCurve(3, 1.5)).toBeCloseTo(1, 12)
  })

  it('at the film defaults: deeper blacks, punchier mids, and a shoulder that rolls into white', () => {
    const k = FILM_LOOK_DEFAULTS.contrast
    // The toe: a dark value goes much darker (slope 0 at black), black stays black.
    expect(contrastCurve(0.1, k)).toBeLessThan(0.07)
    expect(contrastCurve(0.02, k)).toBeLessThan(0.01)
    // The mids: steeper than the identity around mid grey.
    const slope = (contrastCurve(FILM_PIVOT + 0.01, k) - contrastCurve(FILM_PIVOT - 0.01, k)) / 0.02
    expect(slope).toBeGreaterThan(1.3)
    // The highlights: brighter than the identity, and the curve flattens toward white (no hard clip).
    expect(contrastCurve(0.75, k)).toBeGreaterThan(0.75)
    const top = (contrastCurve(1, k) - contrastCurve(0.99, k)) / 0.01
    expect(top).toBeLessThan(0.6)
  })

  it('saturate keeps a color at 1, turns it grey at 0, and never goes negative', () => {
    const c: [number, number, number] = [0.8, 0.3, 0.1]
    expect(saturate(c, 1).map((v, i) => v - c[i]).every((d) => Math.abs(d) < 1e-12)).toBe(true)
    const grey = saturate(c, 0)
    expect(grey[0]).toBeCloseTo(grey[1], 12)
    expect(grey[1]).toBeCloseTo(grey[2], 12)
    expect(Math.min(...saturate([1, 0, 0], 2))).toBeGreaterThanOrEqual(0)
  })

  it('warmthGain is neutral at 0, warm raises red and lowers blue, cool the reverse', () => {
    expect(warmthGain(0)).toEqual([1, 1, 1])
    const [r, g, b] = warmthGain(1)
    expect(r).toBeGreaterThan(1)
    expect(g).toBe(1)
    expect(b).toBeLessThan(1)
    const [rc, , bc] = warmthGain(-1)
    expect(rc).toBeLessThan(1)
    expect(bc).toBeGreaterThan(1)
  })

  it('vignetteAt is 1 at the center, 1 - strength in the corners, and falls monotonically outward', () => {
    expect(vignetteAt(0.5, 0.5, 0.7)).toBe(1)
    for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1]]) expect(vignetteAt(u, v, 0.7)).toBeCloseTo(0.3, 12)
    let prev = 2
    for (let i = 0; i <= 100; i++) {
      const g = vignetteAt(0.5 + i / 200, 0.5 + i / 200, 0.5)
      expect(g).toBeLessThanOrEqual(prev)
      prev = g
    }
    expect(vignetteAt(0, 0.5, 0)).toBe(1) // no vignette, no darkening anywhere
    expect(vignetteAt(0.55, 0.5, 1)).toBe(1) // the middle of the frame is never touched
  })

  it('the grain is deterministic per pixel and seed, centered, and new on every frame', () => {
    expect(hash12(3, 4)).toBe(hash12(3, 4))
    expect(seedOffset(4096 * 5 + 7)).toEqual([7, 5])
    expect(grainNoise(10, 20, 1234)).toBe(grainNoise(10, 20, 1234))
    expect(grainNoise(10, 20, 1234)).not.toBe(grainNoise(10, 20, 1235))
    expect(grainNoise(10, 20, 1234)).not.toBe(grainNoise(11, 20, 1234))
    let sum = 0
    let changed = 0
    const N = 4096
    for (let i = 0; i < N; i++) {
      const n = grainNoise(i % 64, Math.floor(i / 64), 77)
      expect(n).toBeGreaterThanOrEqual(-1)
      expect(n).toBeLessThan(1)
      sum += n
      if (n !== grainNoise(i % 64, Math.floor(i / 64), 78)) changed++
    }
    expect(Math.abs(sum / N)).toBeLessThan(0.05)
    expect(changed).toBeGreaterThan(0.99 * N)
  })

  it('filmSeed: the same script time gives the same seed, frames 1/60 s apart differ, always an exact float integer', () => {
    expect(filmSeed(1000)).toBe(filmSeed(1000))
    expect(filmSeed(1000)).not.toBe(filmSeed(1000 + 1000 / 60))
    expect(filmSeed(1000.4)).toBe(1000)
    expect(filmSeed(-5)).toBeGreaterThanOrEqual(0)
    expect(filmSeed(Number.NaN)).toBe(0)
    expect(filmSeed(2 ** 30)).toBeLessThan(2 ** 24)
  })

  it('filmGrade leaves a pixel unchanged with every tunable neutral (and a straight shoulder)', () => {
    const at = { u: 0.1, v: 0.9, x: 3, y: 4 }
    const out = filmGrade([0.2, 0.5, 0.7], at, NEUTRAL, 5, 1)
    expect(out[0]).toBeCloseTo(0.2, 12)
    expect(out[1]).toBeCloseTo(0.5, 12)
    expect(out[2]).toBeCloseTo(0.7, 12)
  })

  it('filmGrade at the defaults: black stays near black, grain is fine, the corner is darker than the center', () => {
    const d = FILM_LOOK_DEFAULTS
    const black = filmGrade([0, 0, 0], { u: 0.5, v: 0.5, x: 0, y: 0 }, d, 9)
    for (const v of black) expect(Math.abs(v)).toBeLessThanOrEqual(0.25 * d.grain * 0.08 + 1e-12)
    const grey: [number, number, number] = [0.5, 0.5, 0.5]
    const centre = filmGrade(grey, { u: 0.5, v: 0.5, x: 0, y: 0 }, { ...d, grain: 0 }, 9)
    const corner = filmGrade(grey, { u: 0, v: 0, x: 0, y: 0 }, { ...d, grain: 0 }, 9)
    expect(corner[1]).toBeLessThan(centre[1])
    const grained = filmGrade(grey, { u: 0.5, v: 0.5, x: 0, y: 0 }, d, 9)
    expect(Math.abs(grained[1] - centre[1])).toBeLessThanOrEqual(d.grain * 0.08 + 1e-12)
  })

  it('the shader carries the same constants as the TypeScript mirror', () => {
    expect(FILM_FRAGMENT).toContain(`const float PIVOT = ${FILM_PIVOT.toFixed(4)};`)
    expect(FILM_FRAGMENT).toContain(`const float SHOULDER = ${FILM_SHOULDER.toFixed(4)};`)
    expect(FILM_FRAGMENT).toContain('uniform vec2 uSeedOffset;')
    // Floats only: no unsigned integer arithmetic for a GPU compiler to refuse.
    expect(FILM_FRAGMENT).not.toMatch(/\buint\b|\buvec/)
  })

  it('the corners of the film preset are 25 to 35 % darker than the center', () => {
    const corner = vignetteAt(0, 0, FILM_LOOK_DEFAULTS.vignette)
    expect(1 - corner).toBeGreaterThanOrEqual(0.25)
    expect(1 - corner).toBeLessThanOrEqual(0.35)
  })
})
