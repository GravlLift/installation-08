// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { HEAD_TOP } from './body3d'
import {
  CUT_FALL_S,
  CUT_HEADROOM,
  CUT_RISE_S,
  CutFollower,
  FLOOR_MARGIN,
  cutTarget,
  highestDrawn,
  lowestDrawn,
  median,
  smoothCut,
  type CutSource,
} from './topDownLogic'

const source = (over: Partial<CutSource>): CutSource => ({ followedY: null, lastFollowedY: null, livingY: [], previous: null, lowestY: 0, ...over })

describe('cutTarget — the cut follows the followed player, a head and a clearance over his feet', () => {
  it('keeps a standing Spartan under the cut', () => {
    expect(CUT_HEADROOM).toBeGreaterThan(HEAD_TOP)
  })

  it('sits the headroom over the followed feet, whatever the others do', () => {
    expect(cutTarget(source({ followedY: 2, lastFollowedY: 2, livingY: [0, 0, 5, 2] }))).toBeCloseTo(2 + CUT_HEADROOM)
  })

  it('follows a player up a ramp continuously: no floor table, no step', () => {
    // Recharge (match d01ba030): walked heights fill -0.02..5.39 with no gap, ramps join the floors.
    const cuts = [0, 0.5, 1, 1.5, 2, 2.5, 3].map((y) => cutTarget(source({ followedY: y })))
    for (let i = 1; i < cuts.length; i++) expect(cuts[i] - cuts[i - 1]).toBeCloseTo(0.5)
  })

  it('stays over the feet he was last seen on while the followed player is out of life', () => {
    expect(cutTarget(source({ lastFollowedY: 3.2, previous: 0.3, livingY: [0, 0, 0] }))).toBeCloseTo(3.2 + CUT_HEADROOM)
  })

  it('follows the median living player in free camera, or before the followed player was ever seen', () => {
    expect(cutTarget(source({ livingY: [0, 0.1, 5, 0.2, 6] }))).toBeCloseTo(0.2 + CUT_HEADROOM)
    expect(cutTarget(source({ livingY: [0, 0.1, 5, 0.2, 6], previous: 9 }))).toBeCloseTo(0.2 + CUT_HEADROOM)
  })

  it('falls back on the last cut, then on the lowest walked floor, when nobody is alive', () => {
    expect(cutTarget(source({ previous: 3 }))).toBe(3)
    expect(cutTarget(source({ lowestY: -1 }))).toBeCloseTo(-1 + CUT_HEADROOM)
  })
})

describe('median', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNaN()
  })
})

describe('smoothCut — the cut moves toward its target over time', () => {
  it('lands on the target at the first draw', () => {
    expect(smoothCut(null, 3, 0.016)).toBe(3)
  })

  it('rises slowly: a jump (target up ~0.5 u for ~0.6 s) lifts it well under half the jump', () => {
    let cut = 1
    for (let t = 0; t < 0.6; t += 1 / 60) cut = smoothCut(cut, 1.5, 1 / 60)
    expect(cut - 1).toBeLessThan(0.35)
    expect(cut).toBeGreaterThan(1)
  })

  it('falls faster than it rises', () => {
    const up = smoothCut(0, 1, 0.1)
    const down = 1 - smoothCut(1, 0, 0.1)
    expect(down).toBeGreaterThan(up)
    expect(CUT_FALL_S).toBeLessThan(CUT_RISE_S)
  })

  it('reaches the target after a long wait, and stays put without elapsed time', () => {
    expect(smoothCut(0, 2, 10)).toBeCloseTo(2)
    expect(smoothCut(1, 2, 0)).toBe(1)
  })
})

describe('lowestDrawn — the floor of the drawn depth', () => {
  it('is the lowest walked height less the floor margin', () => {
    expect(lowestDrawn([3, -0.02, 5.39])).toBeCloseTo(-0.02 - FLOOR_MARGIN)
  })
  it('is the margin under 0 with no height', () => {
    expect(lowestDrawn([])).toBeCloseTo(-FLOOR_MARGIN)
  })
})

describe('highestDrawn — the fixed cut of the map picture', () => {
  it('is a headroom over the highest walked height', () => {
    expect(highestDrawn([3, -0.02, 5.39])).toBeCloseTo(5.39 + CUT_HEADROOM)
  })
  it('is a headroom over 0 with no height', () => {
    expect(highestDrawn([])).toBeCloseTo(CUT_HEADROOM)
  })
})
describe('CutFollower — the cut of one view over time', () => {
  it('lands on the target first, then keeps the last seen feet while the followed player is out of life', () => {
    const c = new CutFollower(0)
    expect(c.step(0, 'a', 3, [3, 0])).toBeCloseTo(3 + CUT_HEADROOM)
    expect(c.step(10_000, 'a', null, [0, 0])).toBeCloseTo(3 + CUT_HEADROOM)
  })

  it('forgets the last feet for another followed player, and restarts after a reset', () => {
    const c = new CutFollower(0)
    c.step(0, 'a', 3, [3])
    expect(c.step(10_000, 'b', null, [1])).toBeCloseTo(1 + CUT_HEADROOM)
    c.reset()
    expect(c.step(10_001, null, null, [5])).toBeCloseTo(5 + CUT_HEADROOM)
  })
})
