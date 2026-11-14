import { describe, expect, it } from 'vitest'

import { SHROUD_BUBBLE_RADIUS_U, SHROUD_CLOSE_MS, SHROUD_OPEN_MS, shroudBubbleAt } from './shroud3d_logic'

/** 100 ms per frame: the 7.5 s bubble is 75 frames. */
const FRAME_MS = 100

describe('shroudBubbleAt — the bubble over its published window', () => {
  it('stands only from its birth to its deletion', () => {
    expect(shroudBubbleAt(100, 175, 99, FRAME_MS)).toBeNull()
    expect(shroudBubbleAt(100, 175, 175.5, FRAME_MS)).toBeNull()
    expect(shroudBubbleAt(100, 175, 140, FRAME_MS)?.radius).toBe(SHROUD_BUBBLE_RADIUS_U)
  })

  it('swells after its birth and shrinks before its end', () => {
    const half = SHROUD_OPEN_MS / 2 / FRAME_MS
    expect(shroudBubbleAt(100, 175, 100, FRAME_MS)).toBeNull()
    expect(shroudBubbleAt(100, 175, 100 + half, FRAME_MS)?.radius).toBeCloseTo(SHROUD_BUBBLE_RADIUS_U / 2)
    expect(shroudBubbleAt(100, 175, 175 - SHROUD_CLOSE_MS / 2 / FRAME_MS, FRAME_MS)?.radius).toBeCloseTo(SHROUD_BUBBLE_RADIUS_U / 2)
  })

  it('counts its age from its birth, and is a function of the frame alone', () => {
    expect(shroudBubbleAt(100, 175, 130, FRAME_MS)?.ageS).toBeCloseTo(3)
    const a = shroudBubbleAt(100, 175, 120, FRAME_MS)
    shroudBubbleAt(100, 175, 160, FRAME_MS)
    expect(shroudBubbleAt(100, 175, 120, FRAME_MS)).toEqual(a)
  })

  it('the radius is the bubble\'s collision hull, not the 2D screen choice', () => {
    expect(SHROUD_BUBBLE_RADIUS_U).toBe(1.76)
  })
})
