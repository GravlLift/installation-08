import { describe, expect, it } from 'vitest'

import { SHIELD_FLASH_PERIOD_MS, SHIELD_RECHARGE_FULL_MS, shieldFlash, shieldFractionAt, shieldHudAt, shieldHudTrackOf, shieldTransitionsOf } from './shieldHud'

const MS = 33
const FULL_FRAMES = SHIELD_RECHARGE_FULL_MS / MS
const STEP = 1 / 64

// Full until 10; hit at 12 (-> 0.5), hit at 20 (-> 0.2, low), broken at 24, flat at 0 until 174,
// then recharged one sample per frame at the game's pace (1/64 per frame, as the film records it),
// full again at 238. Points without `sh` are positions only.
function life() {
  const points: { t: number; sh?: number }[] = [{ t: 0 }, { t: 10, sh: 1 }, { t: 12, sh: 0.5 }, { t: 20, sh: 0.2 }, { t: 22 }, { t: 24, sh: 0 }, { t: 100, sh: 0 }]
  for (let i = 0; i <= 64; i++) points.push({ t: 174 + i, sh: Math.min(1, i * STEP) })
  points.push({ t: 400, sh: 1 })
  return points
}

describe('shieldFractionAt', () => {
  const track = shieldHudTrackOf(life(), MS, 0)

  it('is full before the first sample (a Spartan spawns full)', () => {
    expect(shieldFractionAt(track, 0)).toBe(1)
    expect(shieldFractionAt(track, 9.9)).toBe(1)
  })

  it('drops instantly at the damage sample', () => {
    expect(shieldFractionAt(track, 11.99)).toBe(1)
    expect(shieldFractionAt(track, 12)).toBe(0.5)
    expect(shieldFractionAt(track, 19.5)).toBe(0.5)
    expect(shieldFractionAt(track, 20)).toBe(0.2)
  })

  it('refills continuously between per-frame samples', () => {
    const a = shieldFractionAt(track, 180)
    const b = shieldFractionAt(track, 180.5)
    const c = shieldFractionAt(track, 181)
    expect(a).toBeCloseTo(6 * STEP, 6)
    expect(c).toBeCloseTo(7 * STEP, 6)
    expect(b).toBeGreaterThan(a)
    expect(b).toBeLessThan(c)
  })

  it('ramps a rise across a replication gap at the game rate, ending on the sample', () => {
    // 0.2 held, then 0.6 four seconds later: the climb takes 0.4 of a full refill, right before it.
    const gap = shieldHudTrackOf([{ t: 0, sh: 0.2 }, { t: 120, sh: 0.6 }], MS, 0)
    const start = 120 - 0.4 * FULL_FRAMES
    expect(shieldFractionAt(gap, start - 1)).toBe(0.2)
    expect(shieldFractionAt(gap, (start + 120) / 2)).toBeCloseTo(0.4, 6)
    expect(shieldFractionAt(gap, 120)).toBe(0.6)
  })

  it('climbs over the whole gap when the samples rise faster than the game rate', () => {
    const fast = shieldHudTrackOf([{ t: 0, sh: 0.2 }, { t: 2, sh: 0.6 }], MS, 0)
    expect(shieldFractionAt(fast, 1)).toBeCloseTo(0.4, 6)
  })

  it('is a pure function of the frame (any visiting order gives the same values)', () => {
    const frames = [5, 12, 30, 190.25, 175.5, 400, 11, 238.75]
    const forward = frames.map((f) => shieldHudAt(track, f))
    const backward = [...frames].reverse().map((f) => shieldHudAt(track, f)).reverse()
    expect(backward).toEqual(forward)
    expect(shieldHudAt(shieldHudTrackOf(life(), MS, 0), 190.25)).toEqual(shieldHudAt(track, 190.25))
  })
})

describe('shieldHudAt states and transitions', () => {
  const track = shieldHudTrackOf(life(), MS, 0)

  it('reads full, damaged, low, broken, recharging, full', () => {
    expect(shieldHudAt(track, 5).state).toBe('full')
    expect(shieldHudAt(track, 15).state).toBe('damaged')
    expect(shieldHudAt(track, 21)).toMatchObject({ state: 'low', since: 20 })
    expect(shieldHudAt(track, 60)).toMatchObject({ state: 'broken', since: 24, fraction: 0 })
    expect(shieldHudAt(track, 200).state).toBe('recharging')
    expect(shieldHudAt(track, 300)).toMatchObject({ state: 'full', fraction: 1 })
  })

  it('lists each change once, a per-frame recharge as one run', () => {
    const transitions = shieldTransitionsOf(life(), MS, 0)
    expect(transitions.map((x) => x.state)).toEqual(['full', 'damaged', 'low', 'broken', 'recharging', 'full'])
    expect(transitions.map((x) => x.frame).slice(0, 4)).toEqual([0, 12, 20, 24])
    // The recharge starts just before the first rising sample (174 -> 175) and ends on the full one.
    const recharge = transitions[4].frame
    expect(recharge).toBeGreaterThanOrEqual(174)
    expect(recharge).toBeLessThan(175)
    expect(transitions[5].frame).toBe(238)
  })

  it('a value repeated for a frame mid-recharge does not interrupt it', () => {
    const points = [{ t: 0, sh: 0 }, { t: 150, sh: 0 }, { t: 151, sh: STEP }, { t: 152, sh: 2 * STEP }, { t: 153, sh: 2 * STEP }, { t: 154, sh: 3 * STEP }, { t: 155, sh: 4 * STEP }, { t: 300, sh: 4 * STEP }]
    expect(shieldTransitionsOf(points, MS, 0).map((x) => x.state)).toEqual(['broken', 'recharging', 'low'])
  })

  it('damage during a recharge stops it', () => {
    const points: { t: number; sh: number }[] = []
    for (let i = 0; i <= 10; i++) points.push({ t: i, sh: 0.5 + i * STEP })
    points.push({ t: 11, sh: 0.3 }, { t: 200, sh: 0.3 })
    const track = shieldHudTrackOf(points, MS, 0)
    expect(shieldHudAt(track, 9.5).state).toBe('recharging')
    expect(shieldHudAt(track, 11)).toMatchObject({ state: 'damaged', fraction: 0.3 })
    expect(track.transitions.map((x) => x.state)).toEqual(['damaged', 'recharging', 'damaged'])
  })

  it('a life without shield samples stays full', () => {
    const track = shieldHudTrackOf([{ t: 5 }, { t: 9 }], MS, 5)
    expect(shieldHudAt(track, 7)).toEqual({ fraction: 1, state: 'full', since: 5 })
  })
})

describe('shieldFlash', () => {
  it('starts lit at the state change and pulses with its period', () => {
    expect(shieldFlash(1000, 1000)).toBe(1)
    expect(shieldFlash(1000, 1000 + SHIELD_FLASH_PERIOD_MS / 2)).toBeCloseTo(0, 6)
    expect(shieldFlash(1000, 1000 + SHIELD_FLASH_PERIOD_MS)).toBeCloseTo(1, 6)
  })
})
