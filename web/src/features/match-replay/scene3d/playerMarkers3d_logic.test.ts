import { describe, expect, it } from 'vitest'

import { DIMMED_MARKER_OPACITY, LOWER_FLOOR_DROP, TAG_OFFSET_PX, declutterTags, levelArrow, topDownMarkers, unitsPerPixel } from './playerMarkers3d_logic'
import { CUT_HEADROOM } from './topDownLogic'

/** The cut over a followed player standing at 0. */
const CUT = CUT_HEADROOM

describe('topDownMarkers — dimmed and chevroned on another floor than the drawn one', () => {
  it('marks a player on the drawn floor at full opacity, no chevron', () => {
    const [m] = topDownMarkers([{ y: 0.3, heading: 0 }], CUT)
    expect(m.opacity).toBe(1)
    expect(m.chevron).toBeNull()
  })

  it('keeps a player a few steps down on the drawn floor', () => {
    const [m] = topDownMarkers([{ y: -LOWER_FLOOR_DROP + 0.1, heading: 0 }], CUT)
    expect(m.chevron).toBeNull()
  })

  it('dims and points up a player above the cut, whose floor is not drawn', () => {
    const [m] = topDownMarkers([{ y: CUT + 0.01, heading: 0 }], CUT)
    expect(m.opacity).toBe(DIMMED_MARKER_OPACITY)
    expect(m.chevron).toBe('above')
  })

  it('dims and points down a player more than the named drop under the drawn floor', () => {
    const [m] = topDownMarkers([{ y: -LOWER_FLOOR_DROP - 0.1, heading: 0 }], CUT)
    expect(m.opacity).toBe(DIMMED_MARKER_OPACITY)
    expect(m.chevron).toBe('below')
  })

  it('dims modestly: an off-floor player stays clearly visible', () => {
    expect(DIMMED_MARKER_OPACITY).toBeGreaterThanOrEqual(0.7)
    expect(DIMMED_MARKER_OPACITY).toBeLessThan(1)
  })

  it('marks every living player, whatever his floor', () => {
    const marks = topDownMarkers([{ y: 40, heading: 0 }, { y: 0, heading: 0 }, { y: -40, heading: 0 }], CUT)
    expect(marks).toHaveLength(3)
    for (const m of marks) expect(m.opacity).toBeGreaterThan(0)
  })

  it('keeps the input order', () => {
    const marks = topDownMarkers([{ y: 9, heading: 0 }, { y: 0, heading: 0 }, { y: -9, heading: 0 }], CUT)
    expect(marks.map((m) => m.chevron)).toEqual(['above', null, 'below'])
  })
})

describe('levelArrow — the up/down arrow of a player on another floor', () => {
  it('points screen up (scene -Z) for a player above the drawn floor', () => {
    expect(levelArrow('above')).toBe(-1)
  })
  it('points screen down (scene +Z) for a player below it', () => {
    expect(levelArrow('below')).toBe(1)
  })
  it('draws none on the drawn floor', () => {
    expect(levelArrow(null)).toBe(0)
  })
  it('follows the marker floor test', () => {
    const marks = topDownMarkers([{ y: 9, heading: 0 }, { y: 0, heading: 0 }, { y: -9, heading: 0 }], CUT)
    expect(marks.map((m) => levelArrow(m.chevron))).toEqual([-1, 0, 1])
  })
})

describe('topDownMarkers — the facing wedge points where the player looks', () => {
  it('points along +X at a zero yaw and along -Z at a 90 yaw', () => {
    const [zero, quarter] = topDownMarkers([{ y: 0, heading: 0 }, { y: 0, heading: 90 }], CUT)
    expect(zero.dirX).toBeCloseTo(1)
    expect(zero.dirZ).toBeCloseTo(0)
    expect(quarter.dirX).toBeCloseTo(0)
    expect(quarter.dirZ).toBeCloseTo(-1)
  })

  it('keeps the facing unit in every direction', () => {
    for (const yaw of [0, 45, 90, 180, 270, 300]) {
      const [m] = topDownMarkers([{ y: 0, heading: yaw }], CUT)
      expect(Math.hypot(m.dirX, m.dirZ)).toBeCloseTo(1)
    }
  })
})

describe('unitsPerPixel — the world size of a screen pixel in the orthographic view', () => {
  it('is the view height over the viewport height', () => {
    expect(unitsPerPixel(20, 800)).toBeCloseTo(0.05)
  })
  it('is 0 for an empty viewport', () => {
    expect(unitsPerPixel(20, 0)).toBe(0)
  })
})

describe('declutterTags — close players keep readable tags', () => {
  const tag = (x: number, y: number, rank: number) => ({ x, y, w: 80, h: 16, rank })

  it('puts every tag over its marker when nothing overlaps', () => {
    expect(declutterTags([tag(0, 0, 1), tag(300, 0, 1)])).toEqual(['above', 'above'])
  })

  it('moves the lower-ranked tag under its marker when two players stand close', () => {
    expect(declutterTags([tag(10, 0, 2), tag(0, 0, 1)])).toEqual(['below', 'above'])
  })

  it('hides a tag with no free place, never one that outranks it', () => {
    expect(declutterTags([tag(0, 0, 0), tag(5, 0, 1), tag(8, 2, 2)])).toEqual(['above', 'below', 'hidden'])
  })

  it('breaks rank ties in input order', () => {
    expect(declutterTags([tag(0, 0, 1), tag(4, 0, 1)])).toEqual(['above', 'below'])
  })

  it('keeps a tag over its marker when the other is far enough under it', () => {
    expect(declutterTags([tag(0, 0, 1), tag(0, 2 * TAG_OFFSET_PX + 40, 1)])).toEqual(['above', 'above'])
  })
})
