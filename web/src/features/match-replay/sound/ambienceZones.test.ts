// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { ambienceLoopAt, prepareAmbienceZones, type AmbienceLayout } from './ambienceZones'

function layout(overrides: Partial<AmbienceLayout> = {}): AmbienceLayout {
  return {
    fallback: 'fb',
    files: { fb: 'fb.ogg', big: 'big.ogg', small: 'small.ogg', tall: 'tall.ogg', nofile: 'never.ogg' },
    zones: [
      // A big area, 20 x 20, from floor 0 up 10: volume 4000.
      { zone: 1, loop: 'big', floor: 0, height: 10, points: [[0, 0], [20, 0], [20, 20], [0, 20]] },
      // A small room inside it, 4 x 4, from floor 0 up 2: volume 32.
      { zone: 2, loop: 'small', floor: 0, height: 2, points: [[8, 8], [12, 8], [12, 12], [8, 12]] },
      // A room above the small one, 4 x 4, from floor 5 up 5: volume 80.
      { zone: 3, loop: 'tall', floor: 5, height: 5, points: [[8, 8], [12, 8], [12, 12], [8, 12]] },
    ],
    ...overrides,
  }
}

describe('prepareAmbienceZones', () => {
  it('drops zones with fewer than 3 points, no height, and a loop with no file entry', () => {
    const l = layout({
      zones: [
        { zone: 1, loop: 'big', floor: 0, height: 10, points: [[0, 0], [20, 0], [20, 20]] },
        { zone: 2, loop: 'small', floor: 0, height: 0, points: [[0, 0], [4, 0], [4, 4], [0, 4]] },
        { zone: 3, loop: 'ghost', floor: 0, height: 5, points: [[0, 0], [4, 0], [4, 4], [0, 4]] },
      ],
    })
    const prepared = prepareAmbienceZones(l)
    expect(prepared.zones).toHaveLength(1)
    expect(prepared.zones[0].loop).toBe('big')
  })
})

describe('ambienceLoopAt', () => {
  it('gives the smallest volume to the zone inside the enclosing one', () => {
    const prepared = prepareAmbienceZones(layout())
    expect(ambienceLoopAt(prepared, { x: 10, y: 10, z: 1 })).toBe('small')
    expect(ambienceLoopAt(prepared, { x: 3, y: 3, z: 1 })).toBe('big')
  })

  it('excludes a zone when z is above its top or below its floor', () => {
    const prepared = prepareAmbienceZones(layout())
    // z = 3 is inside the small room (0..2)? no: above its top, still in the big one.
    expect(ambienceLoopAt(prepared, { x: 10, y: 10, z: 3 })).toBe('big')
    // z = 7 is inside the tall room (5..10) and inside the big one: the tall one wins by volume.
    expect(ambienceLoopAt(prepared, { x: 10, y: 10, z: 7 })).toBe('tall')
    // z = -2 is below every floor: nothing contains the listener.
    expect(ambienceLoopAt(prepared, { x: 10, y: 10, z: -2 })).toBe('fb')
  })

  it('falls back when no zone contains the point and when there is no listener', () => {
    const prepared = prepareAmbienceZones(layout())
    expect(ambienceLoopAt(prepared, { x: 50, y: 50, z: 1 })).toBe('fb')
    expect(ambienceLoopAt(prepared, null)).toBe('fb')
  })

  it('tests XY only when z is absent', () => {
    const prepared = prepareAmbienceZones(layout())
    // Without a z the height is not tested at all: the small room wins on XY alone.
    expect(ambienceLoopAt(prepared, { x: 10, y: 10 })).toBe('small')
    // The same XY with a z above every zone's top falls back instead.
    expect(ambienceLoopAt(prepared, { x: 10, y: 10, z: 99 })).toBe('fb')
  })

  it('ignores zones without a file entry in the lookup', () => {
    const l = layout({
      zones: [
        { zone: 1, loop: 'big', floor: 0, height: 10, points: [[0, 0], [20, 0], [20, 20], [0, 20]] },
        { zone: 2, loop: 'ghost', floor: 0, height: 2, points: [[8, 8], [12, 8], [12, 12], [8, 12]] },
      ],
    })
    const prepared = prepareAmbienceZones(l)
    expect(ambienceLoopAt(prepared, { x: 10, y: 10, z: 1 })).toBe('big')
  })
})
