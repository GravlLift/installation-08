// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { hexRgb, SHIELD_FLOOD_MS, shieldFloodAt, shieldFloodTint } from './shieldFlood'

describe('shieldFlood', () => {
  it('starts at full strength and is over after the grid layer (0.5 s)', () => {
    const start = shieldFloodAt(0)!
    expect(start.flash).toBeCloseTo(1, 6)
    expect(start.grid).toBeCloseTo(1, 6)
    expect(start.exposure).toBeCloseTo(4, 6)
    expect(shieldFloodAt(SHIELD_FLOOD_MS)).toBeNull()
    expect(shieldFloodAt(-1)).toBeNull()
  })

  it('follows the tag cubics: the flash is gone at 0.35 s, the grid still fading', () => {
    const at = shieldFloodAt(350)!
    expect(at.flash).toBe(0)
    expect(at.exposure).toBe(1)
    // grid at x = 0.7: -0.5217 * 0.343 + 2.0435 * 0.49 - 2.5217 * 0.7 + 1
    expect(at.grid).toBeCloseTo(-0.5217388 * 0.343 + 2.043478 * 0.49 - 2.521739 * 0.7 + 1, 4)
    // halfway through the flash (x = 0.5): -0.04 + 0.41 - 1.16 + 1 = 0.21
    expect(shieldFloodAt(175)!.flash).toBeCloseTo(0.21, 4)
  })

  it('tints toward the team color, the two layers multiplying', () => {
    expect(shieldFloodTint({ flash: 1, grid: 0, exposure: 4 }, [34, 197, 94])).toEqual([34, 197, 94])
    expect(shieldFloodTint({ flash: 0, grid: 0, exposure: 1 }, [34, 197, 94])).toEqual([255, 255, 255])
    expect(shieldFloodTint({ flash: 1, grid: 1, exposure: 4 }, [0, 255, 128])).toEqual([0, 255, 64])
  })

  it('parses hex colors', () => {
    expect(hexRgb('#22c55e')).toEqual([0x22, 0xc5, 0x5e])
    expect(hexRgb('#fff')).toEqual([255, 255, 255])
    expect(hexRgb('rgb(1,2,3)')).toEqual([255, 255, 255])
  })
})
