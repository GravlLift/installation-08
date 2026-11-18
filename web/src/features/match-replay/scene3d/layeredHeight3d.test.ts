// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import { initialHeight, heightWeight } from './layeredHeight3d'

describe('height blending', () => {
  it('computes the metal weight at the measured point', () => {
    const h = initialHeight(1, 99 / 255, 170 / 255)
    expect(h).toBeCloseTo(14 / 255)
    const p = { scale: 0, rank: 2, range: 0.9, opacity: 1, accumulation: 1 }
    expect(heightWeight(h, 242 / 255, 82 / 255, p).weight).toBeCloseTo(0.7963, 3)
    expect(heightWeight(h, 242 / 255, 153 / 255, p).weight).toBe(1)
  })

  it('saturates the fourth layer at the wall\'s measured point', () => {
    const p = { scale: 0.35064936, rank: 4, range: 1.333, opacity: 1, accumulation: 0 }
    expect(heightWeight(0.9, 0, 1, p).weight).toBe(1)
  })
})
