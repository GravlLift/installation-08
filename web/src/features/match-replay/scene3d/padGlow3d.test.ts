// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { activeEvents, EQUIPMENT_PAD_TYPE, fadeIn, fadeOut, flareWeight, padSources, parsePadGlow, type PadFlare } from './padGlow3d'

const curve = (v: number, color?: [number, number, number]) => ({ min: v, max: v, ...(color ? { color } : {}) })

// The pad's first lens flare (c2f90227) as the library serves it, trimmed to one reflection.
const served = {
  pad_glow: {
    effect: 'cf098056',
    looping: true,
    parallel: false,
    events: [{ delay: [0.5, 0.5], duration: [0.5, 0.5], lights: [], flares: [
      {
        lens: 'c2f90227',
        falloff: [1.134464, 1.3962634],
        farFade: [10, 20],
        nearFade: [0, 0],
        reflections: [
          { texture: 'fx-426b31d5.png', srgb: true, rotationOffset: 90, radius: curve(0.7), scaleX: curve(0.3), scaleY: curve(0.3), intensity: curve(10), color: curve(0, [0.0065120906, 0.39157248, 0.5647115]) },
          { texture: 'fx-x.png', srgb: true, rotationOffset: 0, radius: curve(0.1), scaleX: curve(1), scaleY: curve(1), intensity: curve(1), color: curve(0) },
        ],
      },
    ] }, { delay: [0, 0], duration: [1, 1], lights: [], flares: [] }],
  },
}

describe('parsePadGlow', () => {
  it('reads the served events and flares and drops a reflection without a color', () => {
    const g = parsePadGlow(served)!
    expect(g).toMatchObject({ looping: true, parallel: false })
    expect(g.events).toHaveLength(2)
    expect(g.events[0].flares[0].reflections).toHaveLength(1)
    expect(g.events[0].flares[0].reflections[0]).toMatchObject({ texture: 'fx-426b31d5.png', srgb: true, rotationOffset: 90 })
  })
  it('plays the pad events in turn, looped every 2 s', () => {
    const g = parsePadGlow(served)!
    expect(activeEvents(g, 0.25)).toEqual([false, false]) // event 0's delay
    expect(activeEvents(g, 0.75)).toEqual([true, false])
    expect(activeEvents(g, 1.5)).toEqual([false, true])
    expect(activeEvents(g, 2.75)).toEqual([true, false])
  })
  it('is null without the field', () => {
    expect(parsePadGlow({})).toBeNull()
    expect(parsePadGlow({ pad_glow: null })).toBeNull()
  })
})

describe('fades', () => {
  it('fades out linearly between its bounds', () => {
    expect(fadeOut(5, 10, 20)).toBe(1)
    expect(fadeOut(15, 10, 20)).toBeCloseTo(0.5)
    expect(fadeOut(25, 10, 20)).toBe(0)
  })
  it('fades in linearly, and an empty range does not fade', () => {
    expect(fadeIn(0.5, 0, 1)).toBeCloseTo(0.5)
    expect(fadeIn(3, 0, 0)).toBe(1)
    expect(fadeOut(3, 0, 0)).toBe(1)
  })
  it('weighs a flare by distance and angle', () => {
    const f = parsePadGlow(served)!.events[0].flares[0] as PadFlare
    expect(flareWeight(f, 5, 0)).toBe(1)
    expect(flareWeight(f, 15, 0)).toBeCloseTo(0.5)
    expect(flareWeight(f, 5, Math.PI / 2)).toBe(0) // past the 80 degree cutoff
  })
})

describe('padSources', () => {
  it('places one source per equipment pad, at its box top center, in three axes', () => {
    const objects = [
      { type: EQUIPMENT_PAD_TYPE | 0, min: [1, 2, 3], max: [3, 6, 4] },
      { type: 0x12345678, min: [0, 0, 0], max: [1, 1, 1] },
    ]
    const s = padSources(objects)
    expect(s).toHaveLength(1)
    expect(s[0].toArray()).toEqual([2, 4, -4])
  })
})
