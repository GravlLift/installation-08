import { describe, expect, it } from 'vitest'

import {
  CUT_STEP_U,
  MINIMAP_IMAGE_SPAN_U,
  MINIMAP_SPAN_U,
  MIN_RENDER_INTERVAL_MS,
  RECENTER_SHARE,
  minimapAngle,
  minimapPoint,
  minimapRect,
  minimapStale,
  minimapUvRows,
  type MinimapPose,
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
  const image: [number, number] = [10, 10]
  const rows = minimapUvRows(pose, image)
  /** The image uv of a scene point: u along +X, v = 0 on the +Z edge. */
  const imageUv = (x: number, z: number) => [0.5 + (x - image[0]) / MINIMAP_IMAGE_SPAN_U, 0.5 - (z - image[1]) / MINIMAP_IMAGE_SPAN_U]

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
      const x = image[0] + (u - 0.5) * MINIMAP_IMAGE_SPAN_U
      const z = image[1] - (v - 0.5) * MINIMAP_IMAGE_SPAN_U
      const [right, up] = minimapPoint(pose, x, z)
      expect(right).toBeCloseTo(mu - 0.5)
      expect(up).toBeCloseTo(mv - 0.5)
    }
  })
})

describe('minimapStale — the cached image is redone at a low rate', () => {
  const img = { center: [0, 0] as [number, number], cutY: 2, at: 1000, followed: 'a' }

  it('is redone at once with no image or another followed player', () => {
    expect(minimapStale(null, img)).toBe(true)
    expect(minimapStale(img, { ...img, at: 1001, followed: 'b' })).toBe(true)
  })

  it('waits the interval, then redoes it for a strayed player or a moved cut', () => {
    const far = RECENTER_SHARE * MINIMAP_SPAN_U + 0.1
    expect(minimapStale(img, { ...img, center: [far, 0], at: 1000 + MIN_RENDER_INTERVAL_MS - 1 })).toBe(false)
    expect(minimapStale(img, { ...img, center: [far, 0], at: 1000 + MIN_RENDER_INTERVAL_MS })).toBe(true)
    expect(minimapStale(img, { ...img, cutY: 2 + CUT_STEP_U + 0.01, at: 5000 })).toBe(true)
  })

  it('keeps it while the player stays near its center on the same floor', () => {
    expect(minimapStale(img, { ...img, center: [1, 1], cutY: 2.1, at: 9000 })).toBe(false)
  })

  it('keeps the turned square inside the image between two renders', () => {
    const halfDiagonal = (MINIMAP_SPAN_U * Math.SQRT2) / 2
    expect(halfDiagonal + RECENTER_SHARE * MINIMAP_SPAN_U).toBeLessThan(MINIMAP_IMAGE_SPAN_U / 2)
  })
})

describe('minimapRect — top right, under the top strip', () => {
  it('sits under the strip inset at the right gap', () => {
    const r = minimapRect({ width: 1600, height: 900 }, { top: 50, bottom: 120 })
    expect(r.left + r.side).toBe(1600 - 16)
    expect(r.top).toBe(50)
  })
})
