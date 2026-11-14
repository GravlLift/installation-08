import { describe, expect, it } from 'vitest'

import { bandAt, floorBands, topDownFrame } from './topDownLogic'

describe('floorBands — one band per floor cluster', () => {
  it('splits where two heights are more than the gap apart and keeps a ramp in one band', () => {
    const bands = floorBands([0, 1, 2, 5, 10, 11, 12], 3)
    expect(bands).toHaveLength(2)
    expect(bands[0]).toEqual({ floorY: -0.5, ceilingY: 7.5 })
    expect(bands[1]).toEqual({ floorY: 9.5, ceilingY: 14.5 })
  })

  it('returns no band without heights', () => {
    expect(floorBands([], 3)).toEqual([])
  })

  it('is clear between floors with the map gap: the ceiling never reaches the next floor', () => {
    // The real numbers of match d01ba030 (Recharge): 228,337 published heights sit in
    // -0.020..5.390 densely, so the map is one floor, band -0.520..7.890; a second floor
    // would stand more than 3 u up.
    const bands = floorBands([-0.02, 0.3, 0.8, 1.5, 2.1, 2.9, 3.4, 4.0, 4.6, 5.1, 5.39], 3)
    expect(bands).toHaveLength(1)
    expect(bands[0].floorY).toBeCloseTo(-0.52)
    expect(bands[0].ceilingY).toBeCloseTo(7.89)
  })
})

describe('floorBands — the cap keeps a ceiling under the next floor when the headroom reaches it', () => {
  it('caps the lower ceiling when the gap is smaller than the headroom plus margin', () => {
    // 0 and 2.9 split at a gap of 2, but the lower headroom (2.5) would cross the upper floor
    // (2.9 - 0.5 = 2.4): the ceiling is capped under it.
    const bands = floorBands([0, 2.9], 2)
    expect(bands).toHaveLength(2)
    expect(bands[0].ceilingY).toBeLessThan(bands[1].floorY)
    expect(bands[0].ceilingY).toBeCloseTo(2.39)
  })

  it('leaves an already clear ceiling alone', () => {
    const bands = floorBands([0, 10], 3)
    expect(bands[0].ceilingY).toBeCloseTo(2.5)
  })
})

describe('bandAt — the band of a height, else the nearest', () => {
  const bands = floorBands([0, 10], 3)
  it('returns the band containing the height', () => {
    expect(bandAt(bands, -0.2)).toBe(bands[0])
    expect(bandAt(bands, 11)).toBe(bands[1])
  })
  it('falls to the nearest band between two floors', () => {
    expect(bandAt(bands, 3)).toBe(bands[0])
    expect(bandAt(bands, 9)).toBe(bands[1])
  })
})

describe('topDownFrame — the area fits the view of its aspect', () => {
  it('centers on the area and fits it at a wide aspect', () => {
    const frame = topDownFrame({ minX: -10, minZ: 0, maxX: 10, maxZ: 20 }, 16 / 9)
    expect(frame.center).toEqual([0, 10])
    expect(frame.halfWidth).toBeCloseTo(17.778)
    expect(frame.halfHeight).toBeCloseTo(10)
  })
  it('fits the area at a tall aspect', () => {
    const frame = topDownFrame({ minX: -10, minZ: 0, maxX: 10, maxZ: 20 }, 9 / 16)
    expect(frame.halfWidth).toBeCloseTo(10)
    expect(frame.halfHeight).toBeCloseTo(17.778)
  })
})
