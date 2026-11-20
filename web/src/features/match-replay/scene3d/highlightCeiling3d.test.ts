// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { FILM_LOOK_DEFAULTS, resolveFilmLook } from './filmLook3d'
import {
  acesFilmic,
  agx,
  CEILING_MAX_STOPS,
  CEILING_SNAP_MS,
  CEILING_TAU_MS,
  ceilingStops,
  ceilingTable,
  chainScreen,
  chainSlope,
  DETAIL_FLOOR_LUMINANCE,
  MeterClock,
  smoothingAlpha,
  steepestLuminance,
  TABLE_LOG_MIN,
  TABLE_SIZE,
  TABLE_STEP,
  tableAt,
  type ToneChain,
} from './highlightCeiling3d'

const GRADE: [number, number, number] = [0.93, 1.02, 1.07]
/** The default view: ACES at the view's exposure (1.15), the grade, no film look. */
const BASE: ToneChain = { exposure: 1.15, grade: GRADE, film: null }
/** demo-3-recharge-pregame's look: the film preset at +0.5 stop. */
const DEMO3: ToneChain = { ...BASE, film: resolveFilmLook({ preset: 'film', exposure: 0.5 }) }
const code = (v: number, chain: ToneChain) => chainScreen(v, chain).map((c) => Math.round(c * 255))

describe('the output chain model', () => {
  it("is three's ACES fit: black stays black, white saturates, grey rises monotonically", () => {
    expect(acesFilmic([0, 0, 0]).every((c) => Math.abs(c) < 1e-3)).toBe(true)
    expect(acesFilmic([100, 100, 100]).every((c) => c === 1)).toBe(true)
    let last = -1
    for (let v = 0.01; v < 20; v *= 1.2) {
      const g = acesFilmic([v, v, v])[1]
      expect(g).toBeGreaterThanOrEqual(last)
      last = g
    }
  })

  it("is three's AgX: monotonic on grey, within [0, 1]", () => {
    let last = -1
    for (let v = 0.001; v < 50; v *= 1.3) {
      const c = agx([v, v, v])
      expect(c.every((x) => x >= 0 && x <= 1)).toBe(true)
      expect(c[1]).toBeGreaterThanOrEqual(last - 1e-9)
      last = c[1]
    }
  })

  it('draws the measured demo-3 pixels: the wall (linear 0.24) and armor (0.35) under the look, and by default', () => {
    // The export's own pixels (frame at 1 s and 1.5 s): wall G 201, armor chest G 222.
    expect(code(0.24, DEMO3)[1]).toBeGreaterThanOrEqual(199)
    expect(code(0.24, DEMO3)[1]).toBeLessThanOrEqual(203)
    expect(code(0.35, DEMO3)[1]).toBeGreaterThanOrEqual(220)
    expect(code(0.35, DEMO3)[1]).toBeLessThanOrEqual(224)
    // The default view draws the same light 40 code values lower on the wall.
    expect(code(0.24, BASE)[1]).toBeLessThan(166)
  })

  it("caps the default view's red at the grade's 0.93: its white is (237, 255, 255)", () => {
    expect(code(1000, BASE)).toEqual([237, 255, 255])
  })

  it('measures detail as code values per stop: the look leaves less of it in the highlights than the default', () => {
    expect(chainSlope(0.45, DEMO3)).toBeLessThan(0.7 * chainSlope(0.45, BASE))
    expect(chainSlope(0.1, DEMO3)).toBeGreaterThan(chainSlope(0.1, BASE))
  })

  it("finds the chain's steepest point near mid grey for the default view, lower for the contrasty look", () => {
    const base = steepestLuminance(BASE)
    expect(base).toBeGreaterThan(0.1)
    expect(base).toBeLessThan(0.3)
    expect(steepestLuminance(DEMO3)).toBeLessThan(base)
  })
})

describe('ceilingStops — the highlight ceiling', () => {
  it('never touches the default view below the detail floor (a white surface under the full sun)', () => {
    for (let p = 0.001; p <= DETAIL_FLOOR_LUMINANCE * 0.999; p *= 1.1) expect(ceilingStops(p, BASE, BASE)).toBe(0)
    expect(DETAIL_FLOOR_LUMINANCE).toBeCloseTo(1.273, 3)
  })

  it('brings an over-lit default frame back to the floor, no further', () => {
    const c = ceilingStops(2.5, BASE, BASE)
    expect(c).toBeCloseTo(Math.log2(DETAIL_FLOOR_LUMINANCE / 2.5), 1)
    expect(c).toBeLessThan(0)
  })

  it("pulls the demo-3 look back on its spawn-room highlights (P about 0.4) until they keep the default's detail", () => {
    const p = 0.4
    const c = ceilingStops(p, DEMO3, BASE)
    expect(c).toBeLessThan(-0.4)
    expect(c).toBeGreaterThan(-0.65)
    expect(chainSlope(p * 2 ** c, DEMO3)).toBeGreaterThanOrEqual(chainSlope(p, BASE) - 1e-6)
    // One step less darkening would leave them flatter than the default draws them.
    expect(chainSlope(p * 2 ** (c + 0.02), DEMO3)).toBeLessThan(chainSlope(p, BASE))
    // The armor chest (0.35) drops from G 222 to about the default's 188 plus the look's punch.
    const chest = code(0.35 * 2 ** c, DEMO3)[1]
    expect(chest).toBeLessThan(210)
    expect(chest).toBeGreaterThan(188)
  })

  it("pulls demo-8's flash-lit freeze (look exposure -0.3, highlight level 1.5 to 2 linear) back by 0.4 to 0.85 stop, inside the cap", () => {
    const demo8: ToneChain = { ...BASE, film: resolveFilmLook({ preset: 'film', exposure: -0.3 }) }
    // The export's own freeze frame, inverted through this chain: 97th percentile at about 1.66.
    const c = ceilingStops(1.66, demo8, BASE)
    expect(c).toBeLessThan(-0.45)
    expect(c).toBeGreaterThan(-0.65)
    expect(ceilingStops(1.5, demo8, BASE)).toBeGreaterThan(-0.5)
    expect(ceilingStops(2, demo8, BASE)).toBeGreaterThan(-0.9)
    // The cap only binds on a frame whose highlights pass about 3.3 linear.
    expect(ceilingStops(3, demo8, BASE)).toBeGreaterThan(-CEILING_MAX_STOPS)
    expect(ceilingStops(4, demo8, BASE)).toBe(-CEILING_MAX_STOPS)
  })

  it("leaves the look's full exposure on a dark frame", () => {
    expect(ceilingStops(0.1, DEMO3, BASE)).toBe(0)
    expect(ceilingStops(0.02, DEMO3, BASE)).toBe(0)
  })

  it('never darkens past CEILING_MAX_STOPS nor below the chain\'s steepest point', () => {
    for (const p of [3, 10, 100, 1000]) {
      for (const chain of [BASE, DEMO3]) {
        const c = ceilingStops(p, chain, BASE)
        expect(c).toBeGreaterThanOrEqual(-CEILING_MAX_STOPS - 1e-9)
        expect(p * 2 ** c).toBeGreaterThanOrEqual(steepestLuminance(chain) * (1 - 1e-9))
      }
    }
  })

  it('is 0 for a look that already darkens (exposure -1) on the spawn-room highlights', () => {
    const dark: ToneChain = { ...BASE, film: { ...FILM_LOOK_DEFAULTS, exposure: -1 } }
    expect(ceilingStops(0.4, dark, BASE)).toBe(0)
  })

  it('works on an AgX look: a finite ceiling in range', () => {
    const agxLook: ToneChain = { ...BASE, film: resolveFilmLook({ preset: 'film', tone: 'agx', exposure: 1 }) }
    for (const p of [0.05, 0.4, 2]) {
      const c = ceilingStops(p, agxLook, BASE)
      expect(Number.isFinite(c)).toBe(true)
      expect(c).toBeLessThanOrEqual(0)
      expect(c).toBeGreaterThanOrEqual(-CEILING_MAX_STOPS)
    }
  })

  it('answers 0 for a black or invalid level', () => {
    expect(ceilingStops(0, DEMO3, BASE)).toBe(0)
    expect(ceilingStops(Number.NaN, DEMO3, BASE)).toBe(0)
  })
})

describe('ceilingTable — what the shader interpolates', () => {
  it('holds TABLE_SIZE entries, all 0 or less, and exactly 0 for the default view below the floor', () => {
    const table = ceilingTable(BASE, BASE)
    expect(table.length).toBe(TABLE_SIZE)
    for (let i = 0; i < TABLE_SIZE; i++) {
      expect(table[i]).toBeLessThanOrEqual(0)
      const p = 2 ** (TABLE_LOG_MIN + i * TABLE_STEP)
      if (p < DETAIL_FLOOR_LUMINANCE) expect(table[i]).toBe(0)
    }
    // Interpolated anywhere under the floor: 0 exactly, so the shader's gain is exp2(0) = 1.
    for (const p of [0.003, 0.18, 0.5, 0.9, 1.1]) expect(tableAt(table, p)).toBe(0)
  })

  it('matches ceilingStops at its knots and interpolates between them', () => {
    const table = ceilingTable(DEMO3, BASE)
    for (const i of [20, 30, 34, 36, 40]) {
      const p = 2 ** (TABLE_LOG_MIN + i * TABLE_STEP)
      expect(tableAt(table, p)).toBeCloseTo(ceilingStops(p, DEMO3, BASE), 5)
    }
    const p = 2 ** (TABLE_LOG_MIN + 34.5 * TABLE_STEP)
    expect(tableAt(table, p)).toBeCloseTo((table[34] + table[35]) / 2, 5)
  })
})

describe('MeterClock — easing on a given clock', () => {
  it('snaps on the first draw, then alternates its two slots with the easing share of each step', () => {
    const clock = new MeterClock()
    const first = clock.step(1000)
    expect(first.read).toBeNull()
    expect(first.alpha).toBe(1)
    const second = clock.step(1100)
    expect(second.read).toBe(first.write)
    expect(second.write).not.toBe(first.write)
    expect(second.alpha).toBeCloseTo(smoothingAlpha(100), 12)
    expect(clock.current).toBe(second.write)
  })

  it('redoes the same step when a frame is drawn again at the same time (a re-render or a subframe)', () => {
    const clock = new MeterClock()
    clock.step(0)
    const step = clock.step(16)
    const again = clock.step(16)
    expect(again.write).toBe(step.write)
    expect(again.read).toBe(step.read)
    expect(again.alpha).toBe(step.alpha)
    expect(clock.step(16)).toEqual(again)
  })

  it('snaps on a time going back, a jump past CEILING_SNAP_MS, and after reset; a re-render there snaps again', () => {
    const clock = new MeterClock()
    clock.step(0)
    clock.step(16)
    expect(clock.step(8).read).toBeNull()
    expect(clock.step(8).read).toBeNull()
    expect(clock.step(8 + CEILING_SNAP_MS + 1).read).toBeNull()
    clock.step(8 + CEILING_SNAP_MS + 20)
    clock.reset()
    expect(clock.step(8 + CEILING_SNAP_MS + 40).read).toBeNull()
  })

  it('eases with time constant CEILING_TAU_MS, and not at all over no time', () => {
    expect(smoothingAlpha(0)).toBe(0)
    expect(smoothingAlpha(-5)).toBe(0)
    expect(smoothingAlpha(CEILING_TAU_MS)).toBeCloseTo(1 - Math.exp(-1), 12)
  })
})
