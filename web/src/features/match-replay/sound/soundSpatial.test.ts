/**
 * soundSpatial.test.ts — the place of a sound in space: closes the gap left since this module's
 * creation (its own header claimed "testable (soundSpatial.test.ts)" without the file ever
 * existing). Covers the fall-off a listening note of 2026-11-16 found under-tested: a near
 * source is louder than a far one, a source within the full radius keeps full gain, an own
 * sound stays centered and full whatever the distance, and the bearing picks a side.
 */
import { describe, expect, it } from 'vitest'

import {
  placeOf,
  spatialOf,
  SPATIAL_FULL_RADIUS,
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

describe('placeOf', () => {
  it('is undefined without a listener, or without a place on the event', () => {
    expect(placeOf(null, { at: { x: 1, y: 1 } })).toBeUndefined()
    expect(placeOf(LISTENER, {})).toBeUndefined()
  })

  it('places an event that carries a place, always as OTHERS (never full by the own rule)', () => {
    const p = placeOf(LISTENER, { at: { x: 0, y: 0 } })
    // At zero distance it is still full (within the full radius), but through the "others"
    // path: an event at the listener's own position gets no special case here.
    expect(p).toEqual({ gain: 1, pan: 0 })
  })
})
