/**
 * weaponSoundLogic.test.ts — THE COMPUTATION OF THE WEAPON SOUNDS, WITHOUT WEBAUDIO.
 *
 * Everything that decides what is heard is pure: the variation drawing, the conversion of
 * the units and the mapping of the distance cursor. These tests fix the two invariants that
 * count for the user — the default settings render the extracted file AS IS,
 * and an absent manifest produces neither error nor abnormal silence.
 */
import { describe, expect, it } from 'vitest'

import {
  clampPercent,
  distanceChain,
  drawRange,
  drawVariation,
  gainFromDb,
  normalizeRange,
  playbackRateFromCents,
} from './weaponSoundLogic'

/** Deterministic generator: a drawing tested at random would prove nothing. */
function drawings(...valeurs: number[]): () => number {
  let i = 0
  return () => valeurs[Math.min(i++, valeurs.length - 1)]
}

describe('unit conversions', () => {
  it('0 dB changes nothing, and the decibels follow the power formula', () => {
    expect(gainFromDb(0)).toBe(1)
    expect(gainFromDb(-20)).toBeCloseTo(0.1, 10)
    expect(gainFromDb(20)).toBeCloseTo(10, 10)
  })

  it('an octave is worth 1200 hundredths, and 0 hundredth leaves the rate at 1', () => {
    expect(playbackRateFromCents(0)).toBe(1)
    expect(playbackRateFromCents(1200)).toBeCloseTo(2, 10)
    expect(playbackRateFromCents(-1200)).toBeCloseTo(0.5, 10)
  })

  it('an aberrant range is bounded rather than rendered inaudible', () => {
    expect(playbackRateFromCents(100_000)).toBe(4)
    expect(playbackRateFromCents(-100_000)).toBe(0.25)
    expect(playbackRateFromCents(Number.NaN)).toBe(1)
  })
})

describe('ranges', () => {
  it('an absent, non-finite or null range means "no variation"', () => {
    expect(normalizeRange(undefined)).toBeNull()
    expect(normalizeRange({ bas: 0, haut: 0 })).toBeNull()
    expect(normalizeRange({ bas: Number.NaN, haut: 1 })).toBeNull()
  })

  it('inverted bounds are put back in order rather than emptying the drawing', () => {
    expect(normalizeRange({ bas: 3, haut: -3 })).toEqual({ bas: -3, haut: 3 })
  })

  it('the drawing sweeps the range from end to end', () => {
    const range = { bas: -4, haut: 2 }
    expect(drawRange(range, 1, drawings(0))).toBeCloseTo(-4, 10)
    expect(drawRange(range, 1, drawings(1))).toBeCloseTo(2, 10)
    expect(drawRange(range, 1, drawings(0.5))).toBeCloseTo(-1, 10)
  })

  it('the setting reduces the BOUNDS, it does not shift the result', () => {
    const range = { bas: -4, haut: 2 }
    // At 50%, the worst case is half the original worst case — and the median drawing stays
    // median. Applying the ratio to the result would have drawn all the sound toward the bass.
    expect(drawRange(range, 0.5, drawings(0))).toBeCloseTo(-2, 10)
    expect(drawRange(range, 0.5, drawings(1))).toBeCloseTo(1, 10)
  })
})

describe('drawVariation', () => {
  const variation = { volume_db: { bas: -2, haut: 2 }, pitch_cents: { bas: -1200, haut: 1200 } }

  it('at 100%, applies the range of the game as is', () => {
    const draw = drawVariation(variation, 100, drawings(1, 1))
    expect(draw.gainDb).toBeCloseTo(2, 10)
    expect(draw.playbackRate).toBeCloseTo(2, 10)
  })

  it('at 0%, returns the EXACT NEUTRAL — the file is played as it was extracted', () => {
    expect(drawVariation(variation, 0, drawings(1, 1))).toEqual({ gainDb: 0, playbackRate: 1 })
  })

  it('without a variation manifest, pure reading and no error', () => {
    expect(drawVariation(undefined, 100, drawings(1))).toEqual({ gainDb: 0, playbackRate: 1 })
    expect(drawVariation({}, 100, drawings(1))).toEqual({ gainDb: 0, playbackRate: 1 })
  })

  it('a volume-only range does not touch the pitch', () => {
    const draw = drawVariation({ volume_db: { bas: -6, haut: 0 } }, 100, drawings(0))
    expect(draw.gainDb).toBeCloseTo(-6, 10)
    expect(draw.playbackRate).toBe(1)
  })

  it('an unreadable or out-of-bounds setting is brought back to [0, 100]', () => {
    expect(clampPercent(Number.NaN)).toBe(0)
    expect(clampPercent(-10)).toBe(0)
    expect(clampPercent(250)).toBe(100)
    expect(drawVariation(variation, 250, drawings(1, 1)).gainDb).toBeCloseTo(2, 10)
  })
})

describe('distanceChain', () => {
  it('at 0%, NO chain — the player must insert no node', () => {
    expect(distanceChain(0)).toBeNull()
    expect(distanceChain(-5)).toBeNull()
    expect(distanceChain(Number.NaN)).toBeNull()
  })

  it('at 100%, attenuates and muddies within the announced bounds', () => {
    const chain = distanceChain(100)
    expect(chain).not.toBeNull()
    expect(chain?.gainDb).toBeCloseTo(-24, 10)
    expect(chain?.cutoffHz).toBeCloseTo(500, 6)
  })

  it('the gain decays in dB and the cut GEOMETRICALLY — otherwise half of the cursor is not heard', () => {
    const half = distanceChain(50)
    expect(half?.gainDb).toBeCloseTo(-12, 10)
    // Geometric middle of 20,000 and 500, not their average (10,250).
    expect(half?.cutoffHz).toBeCloseTo(Math.sqrt(20_000 * 500), 6)
  })

  it('the chain is monotone: farther must never sound louder or clearer', () => {
    let precedentGain = 0
    let precedenteCoupure = 20_000
    for (let d = 10; d <= 100; d += 10) {
      const c = distanceChain(d)
      expect(c!.gainDb).toBeLessThan(precedentGain)
      expect(c!.cutoffHz).toBeLessThan(precedenteCoupure)
      precedentGain = c!.gainDb
      precedenteCoupure = c!.cutoffHz
    }
  })
})
