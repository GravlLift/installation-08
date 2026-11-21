// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { navpointStateAt } from './padNavpoint3d'
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
})
