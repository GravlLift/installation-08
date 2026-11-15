import { describe, expect, it } from 'vitest'

import {
  MINIMAP_IMAGE_MAX_PX,
  MINIMAP_IMAGE_MIN_PX,
  MINIMAP_IMAGE_PX_PER_U,
  MINIMAP_SPAN_U,
  SCREEN_UP_HEADING_DEG,
  minimapAngle,
  minimapHit,
  minimapImageOf,
  minimapPoint,
  minimapRect,
  minimapUvRows,
  type MinimapPose,
  type MinimapRect,
} from './minimapLogic'
import { dirOf } from './playerMarkers3d_logic'

const apply = (rows: ReturnType<typeof minimapUvRows>, u: number, v: number) => rows.map(([a, b, c]) => a * u + b * v + c)

describe('minimapPoint — heading-up: the player faces the minimap up', () => {
  for (const heading of [0, 37, 90, 200, 300]) {
    it(`puts a point ahead of him straight up, and one on his right to the right (yaw ${heading})`, () => {
      const pose: MinimapPose = { center: [5, -3], heading }
      const [fx, fz] = dirOf(heading)
      const ahead = minimapPoint(pose, 5 + fx * 10, -3 + fz * 10)
      expect(ahead[0]).toBeCloseTo(0)
      expect(ahead[1]).toBeCloseTo(10 / MINIMAP_SPAN_U)
      // Seen from above (screen right +X, down +Z), his right is his facing turned clockwise.
      const right = minimapPoint(pose, 5 - fz * 4, -3 + fx * 4)
      expect(right[0]).toBeCloseTo(4 / MINIMAP_SPAN_U)
      expect(right[1]).toBeCloseTo(0)
    })
  }

  it('shows the map north-up for a player facing north (yaw 90 is scene -Z, screen up)', () => {
    const p = minimapPoint({ center: [0, 0], heading: 90 }, 3, 0)
    expect(p[0]).toBeCloseTo(3 / MINIMAP_SPAN_U)
    expect(p[1]).toBeCloseTo(0)
  })
})

describe('minimap — fixed north-up orientation, the map does not turn with the followed player', () => {
  const pose: MinimapPose = { center: [0, 0], heading: SCREEN_UP_HEADING_DEG }

  it('maps scene right to the minimap right and scene -Z to its up, whatever the followed heading would be', () => {
    const [rx, ry] = minimapPoint(pose, 10, 0)
    expect(rx).toBeCloseTo(10 / MINIMAP_SPAN_U)
    expect(ry).toBeCloseTo(0)
    const [ux, uy] = minimapPoint(pose, 0, -10)
    expect(ux).toBeCloseTo(0)
    expect(uy).toBeCloseTo(10 / MINIMAP_SPAN_U)
  })

  it('turns a player wedge on his own heading against the fixed north', () => {
    expect(minimapAngle(pose, SCREEN_UP_HEADING_DEG)).toBeCloseTo(0) // facing north: wedge up
    expect(minimapAngle(pose, 0)).toBeCloseTo(-Math.PI / 2) // facing scene +X (right): wedge right
    expect(minimapAngle(pose, 180)).toBeCloseTo(Math.PI / 2) // facing scene -X (left): wedge left
  })
})

describe('minimapAngle — another player\'s facing on the turned minimap', () => {
  it('is 0 for the followed player\'s own facing', () => {
    expect(minimapAngle({ center: [0, 0], heading: 123 }, 123)).toBeCloseTo(0)
  })
  it('turns counterclockwise for a yaw to his left', () => {
    expect(minimapAngle({ center: [0, 0], heading: 90 }, 180)).toBeCloseTo(Math.PI / 2)
  })
})

describe('minimapUvRows — the minimap quad reads its turned square out of the cached image', () => {
  const pose: MinimapPose = { center: [12, 7], heading: 63 }
  const SIDE = 130
  const image: [number, number] = [10, 10]
  const rows = minimapUvRows(pose, { center: image, side: SIDE })
  /** The image uv of a scene point: u along +X, v = 0 on the +Z edge. */
  const imageUv = (x: number, z: number) => [0.5 + (x - image[0]) / SIDE, 0.5 - (z - image[1]) / SIDE]

  it('reads the player at the minimap center', () => {
    const [u, v] = apply(rows, 0.5, 0.5)
    const [eu, ev] = imageUv(12, 7)
    expect(u).toBeCloseTo(eu)
    expect(v).toBeCloseTo(ev)
  })

  it('reads the point ahead of him at the top edge of the minimap', () => {
    const [fx, fz] = dirOf(63)
    const [u, v] = apply(rows, 0.5, 1)
    const [eu, ev] = imageUv(12 + (fx * MINIMAP_SPAN_U) / 2, 7 + (fz * MINIMAP_SPAN_U) / 2)
    expect(u).toBeCloseTo(eu)
    expect(v).toBeCloseTo(ev)
  })

  it('agrees with minimapPoint everywhere', () => {
    for (const [mu, mv] of [[0, 0], [1, 0], [0.2, 0.9]]) {
      const [u, v] = apply(rows, mu, mv)
      const x = image[0] + (u - 0.5) * SIDE
      const z = image[1] - (v - 0.5) * SIDE
      const [right, up] = minimapPoint(pose, x, z)
      expect(right).toBeCloseTo(mu - 0.5)
      expect(up).toBeCloseTo(mv - 0.5)
    }
  })
})

describe('minimapHit — a canvas point on the minimap square', () => {
  const rect: MinimapRect = { left: 1000, top: 50, side: 200 }

  it('is true inside the square, false just outside it', () => {
    expect(minimapHit(rect, 1000, 50)).toBe(true)
    expect(minimapHit(rect, 1100, 150)).toBe(true)
    expect(minimapHit(rect, 999, 150)).toBe(false)
    expect(minimapHit(rect, 1200, 150)).toBe(false)
    expect(minimapHit(rect, 1100, 49)).toBe(false)
    expect(minimapHit(rect, 1100, 250)).toBe(false)
  })

  it('excludes the right and bottom edges (the square is [left, left+side))', () => {
    expect(minimapHit(rect, rect.left + rect.side, rect.top)).toBe(false)
    expect(minimapHit(rect, rect.left, rect.top + rect.side)).toBe(false)
  })
})

describe('minimapImageOf — one cached image of the whole walked area', () => {
  it('centers on the walked area and leaves room for the turned square on every side', () => {
    const img = minimapImageOf({ minX: -50, minZ: 0, maxX: 50, maxZ: 60 })
    expect(img.center).toEqual([0, 30])
    expect(img.side).toBeCloseTo(100 + MINIMAP_SPAN_U * Math.SQRT2)
    // A player at the area's corner: his turned square's farthest point stays inside the image.
    const reach = Math.hypot(50, 30) + (MINIMAP_SPAN_U * Math.SQRT2) / 2
    expect(Math.hypot(img.side / 2, img.side / 2)).toBeGreaterThan(reach)
  })

  it('keeps the density for an arena, softens a wide area instead of growing past the cap', () => {
    const arena = minimapImageOf({ minX: 0, minZ: 0, maxX: 60, maxZ: 60 })
    expect(arena.px).toBe(Math.ceil(arena.side * MINIMAP_IMAGE_PX_PER_U))
    expect(minimapImageOf({ minX: 0, minZ: 0, maxX: 900, maxZ: 300 }).px).toBe(MINIMAP_IMAGE_MAX_PX)
    expect(minimapImageOf({ minX: 0, minZ: 0, maxX: 0, maxZ: 0 }).px).toBe(Math.max(MINIMAP_IMAGE_MIN_PX, Math.ceil(MINIMAP_SPAN_U * Math.SQRT2 * MINIMAP_IMAGE_PX_PER_U)))
  })
})
describe('minimapRect — top right, under the top strip', () => {
  it('sits under the strip inset at the right gap', () => {
    const r = minimapRect({ width: 1600, height: 900 }, { top: 50, bottom: 120 })
    expect(r.left + r.side).toBe(1600 - 16)
    expect(r.top).toBe(50)
  })
})
