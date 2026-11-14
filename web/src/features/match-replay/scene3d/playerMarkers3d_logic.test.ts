import { describe, expect, it } from 'vitest'

import { DIMMED_MARKER_OPACITY, LOWER_FLOOR_DROP, topDownMarkers, unitsPerPixel } from './playerMarkers3d_logic'
import { CUT_HEADROOM } from './topDownLogic'

/** The cut over a followed player standing at 0. */
const CUT = CUT_HEADROOM

describe('topDownMarkers — dimmed and chevroned on another floor than the drawn one', () => {
  it('marks a player on the drawn floor at full opacity, no chevron', () => {
    const [m] = topDownMarkers([{ y: 0.3, heading: 0 }], CUT)
    expect(m.opacity).toBe(1)
    expect(m.chevron).toBeNull()
  })

  it('keeps a player a few steps down on the drawn floor', () => {
    const [m] = topDownMarkers([{ y: -LOWER_FLOOR_DROP + 0.1, heading: 0 }], CUT)
    expect(m.chevron).toBeNull()
  })

  it('dims and points up a player above the cut, whose floor is not drawn', () => {
    const [m] = topDownMarkers([{ y: CUT + 0.01, heading: 0 }], CUT)
    expect(m.opacity).toBe(DIMMED_MARKER_OPACITY)
    expect(m.chevron).toBe('above')
  })

  it('dims and points down a player more than the named drop under the drawn floor', () => {
    const [m] = topDownMarkers([{ y: -LOWER_FLOOR_DROP - 0.1, heading: 0 }], CUT)
    expect(m.opacity).toBe(DIMMED_MARKER_OPACITY)
    expect(m.chevron).toBe('below')
  })

  it('keeps the input order', () => {
    const marks = topDownMarkers([{ y: 9, heading: 0 }, { y: 0, heading: 0 }, { y: -9, heading: 0 }], CUT)
    expect(marks.map((m) => m.chevron)).toEqual(['above', null, 'below'])
  })
})

describe('topDownMarkers — the facing wedge points where the player looks', () => {
  it('points along +X at a zero yaw and along -Z at a 90 yaw', () => {
    const [zero, quarter] = topDownMarkers([{ y: 0, heading: 0 }, { y: 0, heading: 90 }], CUT)
    expect(zero.dirX).toBeCloseTo(1)
    expect(zero.dirZ).toBeCloseTo(0)
    expect(quarter.dirX).toBeCloseTo(0)
    expect(quarter.dirZ).toBeCloseTo(-1)
  })

  it('keeps the facing unit in every direction', () => {
    for (const yaw of [0, 45, 90, 180, 270, 300]) {
      const [m] = topDownMarkers([{ y: 0, heading: yaw }], CUT)
      expect(Math.hypot(m.dirX, m.dirZ)).toBeCloseTo(1)
    }
  })
})

describe('unitsPerPixel — the world size of a screen pixel in the orthographic view', () => {
  it('is the view height over the viewport height', () => {
    expect(unitsPerPixel(20, 800)).toBeCloseTo(0.05)
  })
  it('is 0 for an empty viewport', () => {
    expect(unitsPerPixel(20, 0)).toBe(0)
  })
})
