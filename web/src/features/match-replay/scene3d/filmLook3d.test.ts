// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { parseCameraScript } from './cameraScript3d'
import {
  contrastCurve,
  FILM_FRAGMENT,
  FILM_LOOK_DEFAULTS,
  FILM_LOOK_RANGES,
  FILM_PIVOT,
  filmGrade,
  filmSeed,
  grainNoise,
  parseFilmLook,
  pcg,
  resolveFilmLook,
  saturate,
  vignetteAt,
  warmthGain,
  type FilmLookSettings,
} from './filmLook3d'

const KEY = { t: 0, pos: { at: 'world', point: [0, 0, 0] }, look: { at: 'world', point: [1, 0, 0] } }
const script = (extra: Record<string, unknown> = {}) => ({ version: 1, matchId: 'm', name: 'shot', keys: [KEY], ...extra })

/** Every tunable neutral: the film pass leaves a pixel as it is. */
const NEUTRAL: FilmLookSettings = { exposure: 0, contrast: 1, saturation: 1, vignette: 0, grain: 0, bloom: 0, warmth: 0 }

describe('parseFilmLook', () => {
  it('accepts a full look and returns a clean copy without unknown fields', () => {
    const raw = { preset: 'film', exposure: -0.5, contrast: 1.3, saturation: 0.9, vignette: 0.4, grain: 0.1, bloom: 1, warmth: -0.2, lut: 'x' }
    const r = parseFilmLook(raw)
    expect(r).toEqual({ look: { preset: 'film', exposure: -0.5, contrast: 1.3, saturation: 0.9, vignette: 0.4, grain: 0.1, bloom: 1, warmth: -0.2 } })
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
    for (const [name, [min, max]] of Object.entries(FILM_LOOK_RANGES)) {
      const v = FILM_LOOK_DEFAULTS[name as keyof FilmLookSettings]
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
  it('contrastCurve maps 0 to 0, 1 to 1 and the pivot to itself, is monotonic, and is the identity at k = 1', () => {
    for (const k of [0.5, 0.8, 1, 1.2, 2]) {
      expect(contrastCurve(0, k)).toBe(0)
      expect(contrastCurve(1, k)).toBeCloseTo(1, 12)
      expect(contrastCurve(FILM_PIVOT, k)).toBeCloseTo(FILM_PIVOT, 12)
      let prev = -1
      for (let i = 0; i <= 1000; i++) {
        const y = contrastCurve(i / 1000, k)
        expect(y).toBeGreaterThanOrEqual(prev)
        expect(y).toBeGreaterThanOrEqual(0)
        expect(y).toBeLessThanOrEqual(1)
        prev = y
      }
    }
    for (let i = 0; i <= 20; i++) expect(contrastCurve(i / 20, 1)).toBeCloseTo(i / 20, 12)
    // More contrast: shadows darker, highlights brighter; out-of-range input is clamped.
    expect(contrastCurve(0.2, 1.5)).toBeLessThan(0.2)
    expect(contrastCurve(0.8, 1.5)).toBeGreaterThan(0.8)
    expect(contrastCurve(-1, 1.5)).toBe(0)
    expect(contrastCurve(3, 1.5)).toBeCloseTo(1, 12)
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
    expect(pcg(0)).toBe(pcg(0))
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
    expect(changed).toBe(N)
  })

  it('filmSeed: the same script time gives the same seed, frames 1/60 s apart differ, always an exact float integer', () => {
    expect(filmSeed(1000)).toBe(filmSeed(1000))
    expect(filmSeed(1000)).not.toBe(filmSeed(1000 + 1000 / 60))
    expect(filmSeed(1000.4)).toBe(1000)
    expect(filmSeed(-5)).toBeGreaterThanOrEqual(0)
    expect(filmSeed(Number.NaN)).toBe(0)
    expect(filmSeed(2 ** 30)).toBeLessThan(2 ** 24)
  })

  it('filmGrade leaves a pixel unchanged with every tunable neutral', () => {
    const at = { u: 0.1, v: 0.9, x: 3, y: 4 }
    const out = filmGrade([0.2, 0.5, 0.7], at, NEUTRAL, 5)
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
    expect(FILM_FRAGMENT).toContain('747796405u')
    expect(FILM_FRAGMENT).toContain('uSeed')
  })
})
