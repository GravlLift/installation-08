// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { aimDegrees, navpointCountdownText, navpointStateAt, NAV_FOCUS_DEGREES } from './padNavpoint3d'
import type { ReplayWeaponPadReady } from '@/lib/replay/replayNormalize'

const pad: ReplayWeaponPadReady = { weapon: 'x', x: 0, y: 0, z: 0, spawns: [10, 60], presence: [{ t0: 10, tLow: 20, tHigh: 30 }, { t0: 60, tLow: 90, tHigh: 90 }] }
describe('pad navpoint', () => {
  it('preserves uncertain occupancy and counts to an observed spawn', () => {
    expect(navpointStateAt(pad, 5, 100)).toEqual({ state: 'empty', seconds: 0.5 })
    expect(navpointStateAt(pad, 15, 100)).toEqual({ state: 'full', seconds: null })
    expect(navpointStateAt(pad, 25, 100)).toEqual({ state: 'uncertain', seconds: null })
    expect(navpointStateAt(pad, 40, 100)).toEqual({ state: 'empty', seconds: 2 })
    expect(navpointStateAt(pad, 60, 100)).toEqual({ state: 'full', seconds: null })
    expect(navpointStateAt({ ...pad, presence: [], spawns: [60] }, 40, 100)).toEqual({ state: 'empty', seconds: 2 })
  })

  it('writes the countdown as the game does: m:ss, rounded up, nothing without a count', () => {
    expect(navpointCountdownText(27.4)).toBe('0:28')
    expect(navpointCountdownText(30)).toBe('0:30')
    expect(navpointCountdownText(90.2)).toBe('1:31')
    expect(navpointCountdownText(0)).toBe('')
    expect(navpointCountdownText(null)).toBe('')
  })

  it('measures the aim angle between the view and the item', () => {
    expect(aimDegrees([0, 0, -1], [0, 0, -10])).toBeCloseTo(0)
    expect(aimDegrees([0, 0, -1], [1, 0, -1])).toBeCloseTo(45)
    // 198 px off the reticle on a 1920 px, 108-degree view: just past the cone's edge.
    const f = 960 / Math.tan((54 * Math.PI) / 180)
    expect(aimDegrees([0, 0, -1], [198, 0, -f])).toBeGreaterThan(NAV_FOCUS_DEGREES)
    expect(aimDegrees([0, 0, -1], [150, 0, -f])).toBeLessThan(NAV_FOCUS_DEGREES)
  })
})
