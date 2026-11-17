// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { BREAK_SECONDS, HIT_SECONDS, NO_SHIELD_FX, shieldFxAt, shieldSamplesOf, type ShieldFx, type ShieldSamples } from './shields3d'

const FPS = 10
const fx = (s: ShieldSamples, f: number): ShieldFx => ({ ...shieldFxAt(s, f, FPS, { ...NO_SHIELD_FX }) })

// Full up to 10, a hit at 12 (1 -> 0.75), a hit at 20 (0.75 -> 0.5), a break at 24, then flat at 0,
// frame-by-frame recharge from 40 to 45 (0 -> 0.235), then flat.
const LIFE = shieldSamplesOf([
  { t: 0, sh: 1 }, { t: 10, sh: 1 }, { t: 11 }, { t: 12, sh: 0.75 }, { t: 20, sh: 0.5 }, { t: 24, sh: 0 },
  { t: 30, sh: 0 }, { t: 40, sh: 0 }, { t: 41, sh: 0.047 }, { t: 42, sh: 0.094 }, { t: 43, sh: 0.141 },
  { t: 44, sh: 0.188 }, { t: 45, sh: 0.235 }, { t: 90, sh: 0.235 },
])

describe('shieldSamplesOf', () => {
  it('keeps only the points that carry a measurement', () => {
    expect(LIFE.t).not.toContain(11)
    expect(LIFE.t).toHaveLength(LIFE.v.length)
  })
})

describe('shieldFxAt', () => {
  it('nothing when the shield is flat', () => {
    expect(fx(LIFE, 5)).toEqual(NO_SHIELD_FX)
    expect(fx(LIFE, 80)).toEqual(NO_SHIELD_FX)
  })

  it('nothing before the first measurement', () => {
    expect(fx(LIFE, -3).hit).toBe(0)
  })

  it('a hit glows at the published drop then decays, and fades out after its duration', () => {
    expect(fx(LIFE, 11.9).hit).toBe(0)
    const at = fx(LIFE, 12)
    expect(at.hit).toBeCloseTo(0.9)
    expect(at.broke).toBe(0)
    expect(fx(LIFE, 13).hit).toBeLessThan(at.hit)
    expect(fx(LIFE, 13).hit).toBeGreaterThan(0)
    expect(fx(LIFE, 12 + HIT_SECONDS * FPS).hit).toBe(0)
  })

  it('the last hit before the frame decides, not an earlier one', () => {
    expect(fx(LIFE, 20).hit).toBeCloseTo(0.9)
  })

  it('a break: glow and flash at the drop to zero, the flash\'s age advances with the frame', () => {
    const at = fx(LIFE, 24)
    expect(at.broke).toBe(1)
    expect(at.breakAge).toBe(0)
    expect(at.hit).toBeCloseTo(1)
    const later = fx(LIFE, 26)
    expect(later.broke).toBeCloseTo(1 - 0.2 / BREAK_SECONDS)
    expect(later.breakAge).toBeCloseTo(0.2)
    expect(fx(LIFE, 24 + BREAK_SECONDS * FPS).broke).toBe(0)
  })

  it('a shield already at zero that stays at zero doesn\'t break', () => {
    expect(fx(LIFE, 31).broke).toBe(0)
    expect(fx(LIFE, 31).hit).toBe(0)
  })

  it('recharge holds as long as neighboring measurements rise, not beyond', () => {
    expect(fx(LIFE, 39).recharge).toBe(0)
    expect(fx(LIFE, 40.5).recharge).toBe(1)
    expect(fx(LIFE, 43.2).recharge).toBe(1)
    expect(fx(LIFE, 45).recharge).toBe(1)
    expect(fx(LIFE, 47.5).recharge).toBe(0)
  })

  it('the recharge\'s age starts at the rise\'s beginning, not the last measurement', () => {
    // The rise starts at 40 (0 -> 0.047 at 41): at 43.2, it has lasted 0.32 s.
    expect(fx(LIFE, 43.2).rechargeAge).toBeCloseTo(0.32)
    expect(fx(LIFE, 40.5).rechargeAge).toBeCloseTo(0.05)
    expect(fx(LIFE, 47.5).rechargeAge).toBe(-1)
  })

  it('sustained fire keeps the glow lit; it fades within half a second of the last hit', () => {
    const burst = shieldSamplesOf([
      { t: 0, sh: 1 }, { t: 1, sh: 0.9 }, { t: 2, sh: 0.8 }, { t: 3, sh: 0.7 }, { t: 4, sh: 0.6 }, { t: 30, sh: 0.6 },
    ])
    for (let f = 1; f <= 4.5; f += 0.25) expect(fx(burst, f).hit).toBeGreaterThan(0.25)
    expect(fx(burst, 4 + HIT_SECONDS * FPS).hit).toBe(0)
    expect(HIT_SECONDS).toBeLessThanOrEqual(0.5)
    expect(BREAK_SECONDS).toBeLessThanOrEqual(0.3)
  })

  it('the same value stepping forward or back, regardless of the previous frame', () => {
    const frames: number[] = []
    for (let f = 0; f <= 60; f += 0.25) frames.push(f)
    const forward = frames.map((f) => fx(LIFE, f))
    const backward = [...frames].reverse().map((f) => fx(LIFE, f)).reverse()
    expect(backward).toEqual(forward)
    const jumbled = frames.map((_, i) => fx(LIFE, frames[(i * 37) % frames.length]))
    expect(jumbled).toEqual(frames.map((_, i) => forward[(i * 37) % frames.length]))
  })
})
