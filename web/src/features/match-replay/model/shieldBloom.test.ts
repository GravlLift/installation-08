// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { SHIELD_BLOOM_FULL_MS, SHIELD_BLOOM_TABLE, shieldBloomIntensity, shieldBloomSource } from './shieldBloom'

describe('shieldBloom', () => {
  it('blooms a little of everything and much more above the threshold, capped at 1', () => {
    expect(shieldBloomSource(0)).toBe(0)
    expect(shieldBloomSource(0.2)).toBeCloseTo(0.07, 9)
    expect(shieldBloomSource(0.4)).toBeCloseTo(0.35 * 0.4 + 3 * 0.1, 9)
    expect(shieldBloomSource(1)).toBe(1)
    const table = SHIELD_BLOOM_TABLE.split(' ').map(Number)
    expect(table).toHaveLength(101)
    expect(table[40]).toBeCloseTo(0.44, 4)
  })

  it('runs at 0.8, from 1.5 right after a refill down to 0.8 over 2633 ms', () => {
    expect(shieldBloomIntensity('damaged', 0)).toBe(0.8)
    expect(shieldBloomIntensity('full', 0)).toBe(1.5)
    expect(shieldBloomIntensity('full', SHIELD_BLOOM_FULL_MS / 2)).toBeCloseTo(1.15, 9)
    expect(shieldBloomIntensity('full', SHIELD_BLOOM_FULL_MS)).toBe(0.8)
  })
})
