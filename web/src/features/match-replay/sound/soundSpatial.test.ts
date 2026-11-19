// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * soundSpatial.test.ts — the place of a sound in space: closes the gap left since this module's
 * creation (its own header claimed "testable (soundSpatial.test.ts)" without the file ever
 * existing). Covers the fall-off a listening note of 2026-11-16 found under-tested: a near
 * source is louder than a far one, a source within the full radius keeps full gain, an own
 * sound stays centered and full whatever the distance, and the bearing picks a side.
 */
import { describe, expect, it } from 'vitest'

import {
  falloffGain,
  INAUDIBLE_LEVEL,
  placeOf,
  spatialOf,
  SPATIAL_FULL_RADIUS,
  type SoundFalloff,
  type SoundListener,
} from './soundSpatial'

const LISTENER: SoundListener = { x: 0, y: 0, heading: 0 }

describe('spatialOf', () => {
  it('keeps full gain, centered, within the full radius', () => {
    const near = spatialOf(LISTENER, { x: SPATIAL_FULL_RADIUS - 0.1, y: 0 }, false)
    expect(near.gain).toBe(1)
  })

  it('decays beyond the full radius, and a farther source is quieter', () => {
    const at10 = spatialOf(LISTENER, { x: 10, y: 0 }, false)
    const at20 = spatialOf(LISTENER, { x: 20, y: 0 }, false)
    expect(at10.gain).toBeGreaterThan(0)
    expect(at10.gain).toBeLessThan(1)
    expect(at20.gain).toBeLessThan(at10.gain)
  })

  it('own stays full and centered whatever the distance', () => {
    const far = spatialOf(LISTENER, { x: 50, y: 50 }, true)
    expect(far).toEqual({ gain: 1, pan: 0 })
  })

  it('pans to the side the source is heard from', () => {
    // Listener faces +X (heading 0): a source to its +Y is to its LEFT, per the module's own
    // convention (right = (sin h, -cos h); heading 0 -> right = (0, -1), so +Y is left).
    const right = spatialOf(LISTENER, { x: 0, y: -10 }, false)
    const left = spatialOf(LISTENER, { x: 0, y: 10 }, false)
    expect(right.pan).toBeGreaterThan(0)
    expect(left.pan).toBeLessThan(0)
  })

  it('a source under the center radius has no side', () => {
    const p = spatialOf(LISTENER, { x: 0.1, y: 0.1 }, false)
    expect(p.pan).toBe(0)
  })
})

// The game's run foot step falloff (1b9ccf03): full to 1 (constant, then exp3), -12 dB at 7
// (then sine), silent at 12.
const RUN: SoundFalloff = [[0, 0, 9], [1, 0, 8], [7, -0.74881136, 1], [12, -0.9999847, 4]]

describe('falloffGain', () => {
  it('reads the game\'s points: full near, -12 dB at 7, silent from 12 on', () => {
    expect(falloffGain(RUN, 0)).toBe(1)
    expect(falloffGain(RUN, 1)).toBe(1)
    expect(20 * Math.log10(falloffGain(RUN, 7))).toBeCloseTo(-12, 1)
    expect(falloffGain(RUN, 12)).toBe(0)
    expect(falloffGain(RUN, 40)).toBe(0)
  })

  it('falls monotonically along the curve', () => {
    let last = 1
    for (let d = 0; d <= 12; d += 0.25) {
      const g = falloffGain(RUN, d)
      expect(g).toBeLessThanOrEqual(last + 1e-9)
      last = g
    }
  })

  it('holds a constant segment at its first value', () => {
    expect(falloffGain([[0, -1, 9], [16.8, -1, 6], [23, -0.6451866, 2], [90, -1, 4]], 10)).toBe(0)
  })
})

describe('spatialOf with a falloff', () => {
  it('follows the falloff, over the 3D distance when both ends have a height', () => {
    const flat = spatialOf({ ...LISTENER, z: 0 }, { x: 7, y: 0, z: 0 }, false, RUN)
    expect(20 * Math.log10(flat.gain)).toBeCloseTo(-12, 1)
    // The same horizontal distance a floor up is farther: quieter.
    const above = spatialOf({ ...LISTENER, z: 0 }, { x: 7, y: 0, z: 3 }, false, RUN)
    expect(above.gain).toBeLessThan(flat.gain)
    // Past the end of the curve: silent.
    expect(spatialOf(LISTENER, { x: 12.5, y: 0 }, false, RUN).gain).toBe(0)
    expect(INAUDIBLE_LEVEL).toBeGreaterThan(0)
  })
})

describe('placeOf', () => {
  it('is undefined without a listener, or without a place on the event', () => {
    expect(placeOf(null, { at: { x: 1, y: 1 } })).toBeUndefined()
    expect(placeOf(LISTENER, {})).toBeUndefined()
  })

  it('silences a sound that carries a falloff when there is no listener', () => {
    expect(placeOf(null, { at: { x: 1, y: 1 }, falloff: RUN })).toEqual({ gain: 0, pan: 0 })
    expect(placeOf(LISTENER, { at: { x: 7, y: 0 }, falloff: RUN })?.gain).toBeCloseTo(0.2512, 3)
  })

  it('places an event that carries a place, always as OTHERS (never full by the own rule)', () => {
    const p = placeOf(LISTENER, { at: { x: 0, y: 0 } })
    // At zero distance it is still full (within the full radius), but through the "others"
    // path: an event at the listener's own position gets no special case here.
    expect(p).toEqual({ gain: 1, pan: 0 })
  })
})
