// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { shieldHudTrackOf } from '../model/shieldHud'
import { testReplayDoc } from '../test/testDoc'
import { followedShieldReader, loopOffsetS, pickRechargeRise, shieldCuesBetween, shieldLoopAt, shieldLoopOf, SHIELD_RISE_TAIL_MS, SHIELD_SOUND, SHIELD_SOUND_STEMS } from './shieldSound'

const MS = 33
const STEP = 1 / 64

// Full until 10; hit at 12 (-> 0.5), hit at 20 (-> 0.2, low), broken at 24, flat at 0 until 174,
// then recharged one sample per frame (1/64 per frame, as the film records it), full at 238.
function brokenLife() {
  const points: { t: number; sh?: number }[] = [{ t: 0 }, { t: 10, sh: 1 }, { t: 12, sh: 0.5 }, { t: 20, sh: 0.2 }, { t: 24, sh: 0 }, { t: 100, sh: 0 }]
  for (let i = 0; i <= 64; i++) points.push({ t: 174 + i, sh: Math.min(1, i * STEP) })
  points.push({ t: 400, sh: 1 })
  return points
}

// Hit to 0.5 at 10, recharge from 160, hit again at 180 mid-recharge (-> 0.3).
function interruptedLife() {
  const points: { t: number; sh?: number }[] = [{ t: 0, sh: 1 }, { t: 10, sh: 0.5 }, { t: 100, sh: 0.5 }]
  for (let i = 0; i <= 19; i++) points.push({ t: 160 + i, sh: 0.5 + i * STEP })
  points.push({ t: 180, sh: 0.3 }, { t: 300, sh: 0.3 })
  return points
}

describe('shieldCuesBetween', () => {
  const track = shieldHudTrackOf(brokenLife(), MS, 0)

  it('fires the break, the recharge (with its refill length) and the full tone of a life, once each', () => {
    const cues = shieldCuesBetween(track, 0, 1000)
    expect(cues.map((c) => c.kind)).toEqual(['break', 'recharge', 'full'])
    expect(cues[0].frame).toBe(24)
    const recharge = cues[1]
    expect(recharge.kind === 'recharge' && recharge.fillMs).toBeGreaterThan(1900)
    expect(cues[1].frame).toBeGreaterThanOrEqual(174)
    expect(cues[1].frame).toBeLessThan(175)
    expect(cues[2].frame).toBe(238)
  })

  it('gives the same cues whatever the steps of the playback (one span or frame by frame)', () => {
    const whole = shieldCuesBetween(track, 0, 400)
    const stepped = []
    for (let f = 0; f < 400; f += 0.37) stepped.push(...shieldCuesBetween(track, f, Math.min(400, f + 0.37)))
    expect(stepped).toEqual(whole)
  })

  it('fires nothing for a span that crosses no transition, and nothing at the life start', () => {
    expect(shieldCuesBetween(track, 30, 170)).toEqual([])
    expect(shieldCuesBetween(track, -10, 11)).toEqual([])
  })

  it('cuts the rise without the full tone when a hit interrupts the recharge', () => {
    const cut = shieldCuesBetween(shieldHudTrackOf(interruptedLife(), MS, 0), 0, 300)
    expect(cut.map((c) => c.kind)).toEqual(['recharge', 'rechargeEnd'])
    // The bar ends the recharge on its last rising sample (179), the hit lands at 180.
    expect(cut[1].frame).toBeGreaterThanOrEqual(179)
    expect(cut[1].frame).toBeLessThanOrEqual(180)
    const fill = cut[0].kind === 'recharge' ? cut[0].fillMs : 0
    expect(fill).toBeCloseTo(1000, -2) // from half: half of the 2 s refill
  })
})

describe('shieldLoopAt', () => {
  const track = shieldHudTrackOf(brokenLife(), MS, 0)

  it('beeps low while low, depleted while broken, nothing while full, damaged or recharging', () => {
    expect(shieldLoopAt(track, 5)).toBeNull()
    expect(shieldLoopAt(track, 15)).toBeNull()
    expect(shieldLoopAt(track, 21)).toEqual({ loop: 'low', since: 20 })
    expect(shieldLoopAt(track, 100)).toEqual({ loop: 'broken', since: 24 })
    expect(shieldLoopAt(track, 200)).toBeNull()
    expect(shieldLoopAt(track, 300)).toBeNull()
  })

  it('maps the bar states', () => {
    expect(['full', 'damaged', 'low', 'broken', 'recharging'].map((s) => shieldLoopOf(s as never))).toEqual([null, null, 'low', 'broken', null])
  })
})

describe('pickRechargeRise', () => {
  // The rises' file lengths measured on the installed game (rise_0 .. rise_9).
  const RISES = [557, 836, 1574, 1727, 686, 2308, 1108, 1372, 1697, 450]

  it('takes the rise that ends with the bar', () => {
    expect(pickRechargeRise(2000, RISES)).toBe(5) // from empty
    expect(pickRechargeRise(250, RISES)).toBe(9)
    expect(pickRechargeRise(1000, RISES)).toBe(6)
    expect(pickRechargeRise(RISES[2] - SHIELD_RISE_TAIL_MS, RISES)).toBe(2)
  })

  it('skips rises not loaded, and says when none is', () => {
    expect(pickRechargeRise(2000, RISES.map((d, i) => (i === 5 ? undefined : d)))).toBe(3)
    expect(pickRechargeRise(2000, [undefined, undefined])).toBe(-1)
  })
})

describe('loopOffsetS', () => {
  it('stands where a loop started at the state start stands now', () => {
    expect(loopOffsetS(0, 0.823)).toBe(0)
    expect(loopOffsetS(1000, 0.8)).toBeCloseTo(0.2, 9)
    expect(loopOffsetS(-5, 0.8)).toBe(0)
    expect(loopOffsetS(100, 0)).toBe(0)
  })
})

describe('followedShieldReader', () => {
  const doc = testReplayDoc({
    frameIntervalMs: 100,
    tracks: [{ slot: 512, xuid: 'A', team: -1, startFrame: 0, endFrame: 100, points: [{ t: 0, x: 0, y: 0, sh: 1 }, { t: 10, x: 0, y: 0, sh: 0.2 }, { t: 100, x: 0, y: 0 }] }],
  })

  it('reads the followed life and the bar the HUD draws, and nothing once he is dead', () => {
    const read = followedShieldReader(doc, 'A')
    expect(read).not.toBeNull()
    const at = read!(20)
    expect(at && shieldLoopAt(at.track, 20)).toEqual({ loop: 'low', since: 10 })
    expect(read!(20)?.track).toBe(at?.track) // built once per life
    expect(read!(101)).toBeNull()
  })

  it('is null in free view, for a player not in the film, and for a film without shields', () => {
    expect(followedShieldReader(doc, null)).toBeNull()
    expect(followedShieldReader(doc, 'absent')).toBeNull()
    const bare = testReplayDoc({ tracks: [{ slot: 512, xuid: 'A', team: -1, startFrame: 0, endFrame: 100, points: [{ t: 0, x: 0, y: 0 }, { t: 100, x: 0, y: 0 }] }] })
    expect(followedShieldReader(bare, 'A')).toBeNull()
  })
})

describe('SHIELD_SOUND_STEMS', () => {
  it('lists every extracted shield file once', () => {
    expect(new Set(SHIELD_SOUND_STEMS).size).toBe(SHIELD_SOUND_STEMS.length)
    expect(SHIELD_SOUND_STEMS).toHaveLength(17)
    expect(SHIELD_SOUND_STEMS).toContain(SHIELD_SOUND.rises[9])
  })
})
