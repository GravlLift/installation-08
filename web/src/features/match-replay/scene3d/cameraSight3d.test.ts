// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** cameraSight3d.test.ts — the camera track's sight block and near cover, on fake casts. */
import { describe, expect, it } from 'vitest'
import {
  LOS_TARGET_MARGIN,
  NEAR_COVER_COLS,
  NEAR_COVER_ROWS,
  nearCoverOf,
  sightBlockOf,
  type DepthCast,
  type SightCast,
  type SightVec3,
} from './cameraSight3d'

/**
 * A fake map of walls perpendicular to the x axis at the given x positions, the camera on the
 * axis at x = 0 looking down +x: a cast meets the first wall within [near, far] along its ray.
 */
function walls(xs: readonly number[]): { cast: SightCast; calls: { near: number; far: number }[] } {
  const calls: { near: number; far: number }[] = []
  const cast: SightCast = (origin, dir, near, far) => {
    calls.push({ near, far })
    let best: number | null = null
    for (const x of xs) {
      if (Math.abs(dir[0]) < 1e-12) continue
      const d = (x - origin[0]) / dir[0]
      if (d >= near && d <= far && (best === null || d < best)) best = d
    }
    return best
  }
  return { cast, calls }
}

const CAM: SightVec3 = [0, 0, 0]
const FWD: SightVec3 = [1, 0, 0]
const TARGET: SightVec3 = [10, 0, 0]

describe('sightBlockOf', () => {
  it('is null on a clear line, the wall distance when one stands between', () => {
    expect(sightBlockOf(CAM, TARGET, 0.02, FWD, walls([]).cast)).toBeNull()
    expect(sightBlockOf(CAM, TARGET, 0.02, FWD, walls([4]).cast)).toBeCloseTo(4, 9)
    expect(sightBlockOf(CAM, TARGET, 0.02, FWD, walls([6, 4]).cast)).toBeCloseTo(4, 9)
  })

  it('skips the last margin before the target (the subject’s own floor)', () => {
    expect(sightBlockOf(CAM, TARGET, 0.02, FWD, walls([10 - LOS_TARGET_MARGIN / 2]).cast)).toBeNull()
  })

  it('ignores hits nearer than the near plane: a cutaway behind a wall is not flagged', () => {
    // The wall at 1.5 u is behind a 2 u near plane: clipped away, not drawn, not a block.
    expect(sightBlockOf(CAM, TARGET, 2, FWD, walls([1.5]).cast)).toBeNull()
    // A second wall past the near plane still blocks.
    expect(sightBlockOf(CAM, TARGET, 2, FWD, walls([1.5, 5]).cast)).toBeCloseTo(5, 9)
    // With the view's own near plane the same wall blocks at its distance.
    expect(sightBlockOf(CAM, TARGET, 0.02, FWD, walls([1.5]).cast)).toBeCloseTo(1.5, 9)
  })

  it('limits both casts at the near plane: the camera cast starts there, the target cast stops there', () => {
    const { cast, calls } = walls([])
    sightBlockOf(CAM, TARGET, 2, FWD, cast)
    const reach = 10 - LOS_TARGET_MARGIN
    expect(calls).toHaveLength(2)
    expect(calls[0].near).toBeCloseTo(2, 9)
    expect(calls[0].far).toBeCloseTo(reach, 9)
    expect(calls[1].near).toBe(0)
    expect(calls[1].far).toBeCloseTo(reach - 2, 9)
  })

  it('measures the near plane along the view axis: an off-axis sight line reaches it farther out', () => {
    const { cast, calls } = walls([])
    const forward: SightVec3 = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3), 0] // 60 degrees off the sight line
    sightBlockOf(CAM, TARGET, 1, forward, cast)
    expect(calls[0].near).toBeCloseTo(2, 9) // depth 1 at cos 0.5 is 2 u along the line
  })

  it('is null when the near plane clips the whole line, or the target is on the camera', () => {
    expect(sightBlockOf(CAM, [1, 0, 0], 2, FWD, walls([0.5]).cast)).toBeNull()
    expect(sightBlockOf(CAM, [LOS_TARGET_MARGIN / 2, 0, 0], 0.02, FWD, walls([0.01]).cast)).toBeNull()
  })
})

describe('nearCoverOf', () => {
  it('casts the 12 x 7 grid through the cells’ centers, inside the frame', () => {
    const seen: [number, number][] = []
    const cover = nearCoverOf(0.02, 10, (x, y) => { seen.push([x, y]); return null })
    expect(cover).toBe(0)
    expect(NEAR_COVER_COLS).toBe(12)
    expect(NEAR_COVER_ROWS).toBe(7)
    expect(seen).toHaveLength(84)
    for (const [x, y] of seen) {
      expect(Math.abs(x)).toBeLessThan(1)
      expect(Math.abs(y)).toBeLessThan(1)
    }
    expect(new Set(seen.map(([x]) => x)).size).toBe(12)
    expect(new Set(seen.map(([, y]) => y)).size).toBe(7)
  })

  it('counts the share of rays meeting geometry nearer than 35% of the look distance', () => {
    // A wall slab across the left third of the frame (x < -1/3) at depth 2, look distance 10 (limit 3.5).
    const slab: DepthCast = (x, _y, min, max) => (x < -1 / 3 && 2 >= min && 2 <= max ? 2 : null)
    expect(nearCoverOf(0.02, 10, slab)).toBeCloseTo(4 / 12, 9) // 4 of 12 columns
    // The same slab past the limit (look distance 5: limit 1.75) does not count.
    expect(nearCoverOf(0.02, 5, slab)).toBe(0)
  })

  it('ignores geometry nearer than the near plane (a cutaway wall)', () => {
    const asked: { min: number; max: number }[] = []
    const everywhere: DepthCast = (_x, _y, min, max) => { asked.push({ min, max }); return 1.5 >= min && 1.5 <= max ? 1.5 : null }
    expect(nearCoverOf(0.02, 10, everywhere)).toBe(1) // the whole frame is a wall at 1.5 u
    expect(nearCoverOf(2, 10, everywhere)).toBe(0) // behind a 2 u near plane: clipped away
    expect(asked.at(-1)).toEqual({ min: 2, max: 3.5 })
    // A cast that returns a hit outside the range anyway is not counted.
    expect(nearCoverOf(2, 10, () => 1)).toBe(0)
    expect(nearCoverOf(2, 10, () => 3.5)).toBe(0)
  })

  it('is 0 without a depth range to test', () => {
    let calls = 0
    expect(nearCoverOf(4, 10, () => { calls++; return 1 })).toBe(0) // near 4 beyond the 3.5 limit
    expect(nearCoverOf(0.02, 0, () => { calls++; return 0.01 })).toBe(0)
    expect(calls).toBe(0)
  })
})
