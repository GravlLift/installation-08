import { describe, expect, it } from 'vitest'
import { bandAt, floorBands, topDownFrame } from './topDownLogic'

describe('floorBands', () => {
  it('returns one band for one floor', () => {
    expect(floorBands([0, 0.2, 0.4, -0.1], 3)).toEqual([{ floorY: -0.6, ceilingY: 2.9 }])
  })
  it('returns two bands for two stacked floors', () => {
    const bands = floorBands([0, 0.1, 10, 10.2], 3)
    expect(bands).toHaveLength(2)
    expect(bands[0]).toEqual({ floorY: -0.5, ceilingY: 2.6 })
    expect(bands[1]).toEqual({ floorY: 9.5, ceilingY: 12.7 })
  })
  it('keeps a ramp between floors in a single band', () => {
    const ramp = Array.from({ length: 41 }, (_, i) => i * 0.2) // 0 to 8, continuously spread
    expect(floorBands(ramp, 3)).toHaveLength(1)
  })
  it('returns no band for an empty input', () => {
    expect(floorBands([], 3)).toEqual([])
  })
})

describe('bandAt', () => {
  const bands = floorBands([0, 0.1, 10, 10.2], 3)
  it('returns the containing band', () => {
    expect(bandAt(bands, 0)).toBe(bands[0])
    expect(bandAt(bands, 10.5)).toBe(bands[1])
  })
  it('returns the nearest band outside of any band', () => {
    expect(bandAt(bands, -100)).toBe(bands[0])
    expect(bandAt(bands, 100)).toBe(bands[1])
    expect(bandAt(bands, 6.0)).toBe(bands[0])
    expect(bandAt(bands, 6.2)).toBe(bands[1])
  })
})

describe('topDownFrame', () => {
  it('fits a wide area in a wide view', () => {
    const frame = topDownFrame({ minX: -20, minZ: -10, maxX: 20, maxZ: 10 }, 16 / 9)
    expect(frame.center).toEqual([0, 0])
    expect(frame.halfWidth).toBe(20)
    expect(frame.halfHeight).toBeCloseTo(11.25)
    expect(frame.halfHeight).toBeGreaterThanOrEqual(10)
  })
  it('fits a deep area in a wide view by the depth', () => {
    const frame = topDownFrame({ minX: -5, minZ: -30, maxX: 5, maxZ: 30 }, 16 / 9)
    expect(frame.halfHeight).toBe(30)
    expect(frame.halfWidth).toBeCloseTo(53.33)
    expect(frame.halfWidth).toBeGreaterThanOrEqual(5)
  })
  it('centers an off-origin area', () => {
    const frame = topDownFrame({ minX: 0, minZ: 0, maxX: 40, maxZ: 20 }, 1)
    expect(frame.center).toEqual([20, 10])
    expect(frame.halfWidth).toBe(20)
    expect(frame.halfHeight).toBe(20)
  })
})
