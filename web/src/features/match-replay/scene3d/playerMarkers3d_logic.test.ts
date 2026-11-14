import { describe, expect, it } from 'vitest'

import { DIMMED_MARKER_OPACITY, MARKER_RADIUS, MARKER_SIZE_FACTOR, topDownMarkers } from './playerMarkers3d_logic'
import { floorBands, type FloorBand } from './topDownLogic'
import { BODY_RADIUS } from './body3d'

/** Two stacked floors, the way an indoor map reads: 0..2 standing, 10..12 standing. */
const bands: FloorBand[] = floorBands([0, 1, 2, 10, 11, 12], 3)

describe('topDownMarkers — one marker per living player, dimmed and chevroned off-band', () => {
  it('marks a living player in the drawn band at full opacity, no chevron', () => {
    const [m] = topDownMarkers([{ xuid: 'a', y: 1, heading: 0, alive: true }], bands, bands[0])
    expect(m.visible).toBe(true)
    expect(m.opacity).toBe(1)
    expect(m.chevron).toBeNull()
  })

  it('marks no dead player', () => {
    const [m] = topDownMarkers([{ xuid: 'a', y: 1, heading: 0, alive: false }], bands, bands[0])
    expect(m.visible).toBe(false)
  })

  it('dims and points up a player on the floor above the drawn one', () => {
    const [m] = topDownMarkers([{ xuid: 'a', y: 11, heading: 0, alive: true }], bands, bands[0])
    expect(m.visible).toBe(true)
    expect(m.opacity).toBe(DIMMED_MARKER_OPACITY)
    expect(m.chevron).toBe('above')
  })

  it('dims and points down a player on the floor below the drawn one', () => {
    const [m] = topDownMarkers([{ xuid: 'a', y: 1, heading: 0, alive: true }], bands, bands[1])
    expect(m.opacity).toBe(DIMMED_MARKER_OPACITY)
    expect(m.chevron).toBe('below')
  })

  it('marks nothing at all with no drawn band', () => {
    const [m] = topDownMarkers([{ xuid: 'a', y: 1, heading: 0, alive: true }], bands, null)
    expect(m.visible).toBe(false)
    expect(m.chevron).toBeNull()
  })
})

describe('topDownMarkers — the facing wedge points where the player looks', () => {
  it('points along +X at a zero yaw and along -Z at a 90 yaw', () => {
    const [zero] = topDownMarkers([{ xuid: 'a', y: 1, heading: 0, alive: true }], bands, bands[0])
    expect(zero.dirX).toBeCloseTo(1)
    expect(zero.dirZ).toBeCloseTo(0)
    const [quarter] = topDownMarkers([{ xuid: 'a', y: 1, heading: 90, alive: true }], bands, bands[0])
    expect(quarter.dirX).toBeCloseTo(0)
    expect(quarter.dirZ).toBeCloseTo(-1)
  })

  it('keeps the facing unit in every direction', () => {
    for (const yaw of [0, 45, 90, 180, 270, 300]) {
      const [m] = topDownMarkers([{ xuid: 'a', y: 1, heading: yaw, alive: true }], bands, bands[0])
      expect(Math.hypot(m.dirX, m.dirZ)).toBeCloseTo(1)
    }
  })
})

describe('MARKER_RADIUS — sized from the body radius', () => {
  it('is the body radius times the named factor', () => {
    expect(MARKER_RADIUS).toBe(BODY_RADIUS * MARKER_SIZE_FACTOR)
    expect(MARKER_RADIUS).toBeGreaterThan(BODY_RADIUS)
  })
})
