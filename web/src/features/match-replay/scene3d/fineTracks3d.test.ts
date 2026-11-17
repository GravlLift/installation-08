// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import type { ReplayFullRateReady } from '@/lib/replay/replayFullRate'

import { aimAt, fineLifePoints, HOLD_AFTER_TICKS, lifeTick } from './fineTracks3d'

/** A 60 Hz tick on a 100 ms grid, in frames. */
const TICK = 1 / 6

function life(partial: Partial<ReplayFullRateReady>): ReplayFullRateReady {
  return { t: [], x: [], y: [], z: [], gaps: [], aimT: [], h: [], p: [], ...partial }
}

describe('fineLifePoints', () => {
  it('keeps each sample at its own instant, without snapping it to the grid', () => {
    const t = [0, TICK, 2 * TICK, 3 * TICK]
    const pts = fineLifePoints(life({ t, x: [0, 1, 2, 3], y: [0, 0, 0, 0], z: [0, 0, 0, 0] }))
    expect(pts.map((p) => p.t)).toEqual(t)
    expect(pts.map((p) => p.x)).toEqual([0, 1, 2, 3])
  })

  it('reads aim on its own axis, exact at its instants and interpolated between them', () => {
    const t = [0, TICK, 2 * TICK]
    const pts = fineLifePoints(
      life({ t, x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0], aimT: [0, 2 * TICK], h: [350, 10], p: [0, 4] }),
    )
    expect(pts[0].h).toBe(350)
    // Halfway, the heading passes through 0 (shortest path), not 180.
    expect(((pts[1].h % 360) + 360) % 360).toBeCloseTo(0, 6)
    expect(pts[1].p).toBeCloseTo(2, 6)
    expect(pts[2].h).toBe(10)
    expect(pts.every((p) => p.aim)).toBe(true)
  })

  it("holds the position during a silence and only moves on the last tick", () => {
    const t = [0, TICK, 2 * TICK, 12 * TICK]
    const pts = fineLifePoints(life({ t, x: [0, 0, 1, 5], y: [0, 0, 0, 0], z: [0, 0, 0, 0] }))
    expect(pts).toHaveLength(5)
    expect(pts[3].t).toBeCloseTo(11 * TICK, 9)
    expect(pts[3].x).toBe(1)
    expect(pts[4].x).toBe(5)
  })

  it('marks the gap on the point that follows it, with no holding point', () => {
    const t = [0, TICK, 80 * TICK]
    const pts = fineLifePoints(life({ t, x: [0, 1, 9], y: [0, 0, 0], z: [0, 0, 0], gaps: [2] }))
    expect(pts.map((p) => p.g)).toEqual([0, 0, 1])
  })
})

describe('aimAt', () => {
  it("holds the aim after a silence until one tick before the next", () => {
    const fr = life({ aimT: [0, 10 * TICK], h: [0, 90], p: [0, 0] })
    expect(aimAt(fr, 5 * TICK, TICK).h).toBe(0)
    expect(aimAt(fr, 9.5 * TICK, TICK).h).toBeCloseTo(45, 6)
    expect(aimAt(fr, 10 * TICK, TICK).h).toBe(90)
  })

  it('returns the first aim, unknown, before the first sample', () => {
    const fr = life({ aimT: [3], h: [12], p: [1] })
    expect(aimAt(fr, 1, TICK)).toEqual({ h: 12, p: 1, known: false })
    expect(aimAt(life({}), 1, TICK).known).toBe(false)
  })
})

describe('lifeTick', () => {
  it("takes the median gap between positions", () => {
    expect(lifeTick([0, TICK, 2 * TICK, 3 * TICK, 40])).toBeCloseTo(TICK, 9)
    expect(lifeTick([1])).toBeCloseTo(TICK, 9)
    expect(HOLD_AFTER_TICKS).toBeGreaterThan(1)
  })
})
