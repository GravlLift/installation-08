// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import type { ReplayTrackReady } from '../../../lib/replay/replayReadyTypes'
import { CALLOUT_PROBE_ABOVE_M, calloutAt, calloutName, calloutOfLivesAt, inPolygon, prepareCallouts, type MapCallouts } from './mapCallouts'

// Two floors over one square, and a small room nested in the ground floor.
const set: MapCallouts = {
  version: 1,
  source: 'level',
  zones: [
    { en: 'Hall', fr: 'Salle', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]], zBottom: 0.2, zTop: 4 },
    { en: 'Overhang', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]], zBottom: 4.3, zTop: 6.3 },
    { en: 'Closet', polygon: [[1, 1], [3, 1], [3, 3], [1, 3]], zBottom: 0.2, zTop: 4 },
    { en: 'Flat', polygon: [[0, 0], [10, 0], [10, 10]], zBottom: 1, zTop: 1 },
  ],
}
const prepared = prepareCallouts(set)

describe('mapCallouts', () => {
  it('inPolygon: inside, outside, concave notch', () => {
    const u: [number, number][] = [[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3]]
    expect(inPolygon(u, 0.5, 2)).toBe(true)
    expect(inPolygon(u, 1.5, 2)).toBe(false)
    expect(inPolygon(u, 4, 1)).toBe(false)
  })

  it('picks the floor by height, probing half a meter above the track z', () => {
    expect(calloutAt(prepared, 5, 5, 0)?.en).toBe('Hall')
    expect(calloutAt(prepared, 5, 5, 4.3 - CALLOUT_PROBE_ABOVE_M)?.en).toBe('Overhang')
    expect(calloutAt(prepared, 5, 5, 9)).toBeNull()
  })

  it('the smallest overlapping area wins; outside every area is null', () => {
    expect(calloutAt(prepared, 2, 2, 0)?.en).toBe('Closet')
    expect(calloutAt(prepared, 20, 20, 0)).toBeNull()
  })

  it('without a z the height is not tested', () => {
    expect(calloutAt(prepared, 2, 2, undefined)?.en).toBe('Closet')
  })

  it('no areas, no lookup', () => {
    expect(prepareCallouts({ version: 1, source: 'level', zones: [] })).toBeNull()
    expect(prepareCallouts(null)).toBeNull()
    expect(calloutAt(null, 0, 0, 0)).toBeNull()
  })

  it('names in the viewer language, English as the fallback', () => {
    expect(calloutName(calloutAt(prepared, 5, 5, 0), 'fr')).toBe('Salle')
    expect(calloutName(calloutAt(prepared, 5, 5, 4), 'fr')).toBe('Overhang')
    expect(calloutName(null, 'en')).toBeNull()
  })

  it('a player is placed by the life alive at the frame, its sample in force', () => {
    const life = { slot: 1, xuid: 'A', team: 0, startFrame: 10, endFrame: 20, points: [{ t: 10, x: 2, y: 2, z: 0 }, { t: 15, x: 5, y: 5, z: 4 }] } as unknown as ReplayTrackReady
    expect(calloutOfLivesAt(prepared, [life], 12)?.en).toBe('Closet')
    expect(calloutOfLivesAt(prepared, [life], 16)?.en).toBe('Overhang')
    expect(calloutOfLivesAt(prepared, [life], 5)).toBeNull()
    expect(calloutOfLivesAt(prepared, [life], 30)).toBeNull()
    expect(calloutOfLivesAt(prepared, undefined, 12)).toBeNull()
  })
})
