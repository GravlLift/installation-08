/**
 * reloadLoudness.test.ts — the measured level of a take, and the one gain of a reload.
 */
import { describe, expect, it } from 'vitest'

import { RELOAD_LEVEL_TARGET_DB, RELOAD_PEAK_CEILING_DB, levelOf, reloadGainDb, soundLevelDb } from './reloadLoudness'

describe('levelOf', () => {
  it('measures RMS and peak over every channel, in dBFS', () => {
    const square = new Float32Array([0.5, -0.5, 0.5, -0.5])
    const level = levelOf([square, square])
    expect(level.rmsDb).toBeCloseTo(-6.02, 2)
    expect(level.peakDb).toBeCloseTo(-6.02, 2)
    const half = levelOf([new Float32Array([1, 0, 0, 0])])
    expect(half.peakDb).toBeCloseTo(0, 5)
    expect(half.rmsDb).toBeCloseTo(-6.02, 2)
  })

  it('silence has a finite floor', () => {
    const silent = levelOf([new Float32Array(8)])
    expect(Number.isFinite(silent.rmsDb)).toBe(true)
    expect(Number.isFinite(silent.peakDb)).toBe(true)
  })
})

describe('reloadGainDb', () => {
  it('brings the loudest sound to the target, whatever the weapon', () => {
    const loud = [[{ rmsDb: -14, peakDb: -3 }], [{ rmsDb: -26, peakDb: -10 }]]
    const quiet = [[{ rmsDb: -28, peakDb: -15 }]]
    expect(reloadGainDb(loud)).toBeCloseTo(RELOAD_LEVEL_TARGET_DB + 14)
    expect(reloadGainDb(quiet)).toBeCloseTo(RELOAD_LEVEL_TARGET_DB + 28)
    expect(-14 + reloadGainDb(loud)).toBeCloseTo(-28 + reloadGainDb(quiet))
  })

  it('one gain for the whole reload keeps its sounds apart', () => {
    const sounds = [[{ rmsDb: -18, peakDb: -4 }], [{ rmsDb: -30, peakDb: -12 }]]
    const g = reloadGainDb(sounds)
    expect(-18 + g - (-30 + g)).toBeCloseTo(12)
  })

  it('a sound is the power mean of its takes', () => {
    expect(soundLevelDb([{ rmsDb: -20, peakDb: 0 }, { rmsDb: -20, peakDb: 0 }])).toBeCloseTo(-20)
    expect(soundLevelDb([{ rmsDb: -20, peakDb: 0 }, { rmsDb: -120, peakDb: -120 }])).toBeCloseTo(-23.01, 1)
  })

  it('never leaves a peak above the ceiling', () => {
    const quietButPeaky = [[{ rmsDb: -30, peakDb: -2 }]]
    expect(reloadGainDb(quietButPeaky)).toBeCloseTo(RELOAD_PEAK_CEILING_DB + 2)
  })

  it('nothing measured keeps the files level', () => {
    expect(reloadGainDb([])).toBe(0)
    expect(reloadGainDb([[], []])).toBe(0)
  })
})
