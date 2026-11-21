// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import {
  DOCK_CENTER_X,
  DOCK_CENTER_Y,
  DOCK_RADIUS_X,
  DOCK_RADIUS_Y,
  dockOnOval,
  navpointScreenPosition,
  projectToScreen,
} from './padNavpointMath3d'

/** A camera at the origin looking down -Z (three.js default), with a 45-degree vertical FOV and 1:1 aspect. */
const CAM_IDENTITY = new Float64Array([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
])

/** A perspective projection matrix for a 45-degree vertical FOV, 1:1 aspect, near=0.1, far=100. */
function perspectiveMatrix(fovY: number, aspect: number, near: number, far: number): Float64Array {
  const f = 1 / Math.tan(fovY / 2)
  const m = new Float64Array(16)
  m[0] = f / aspect
  m[5] = f
  m[10] = (far + near) / (near - far)
  m[11] = -1
  m[14] = (2 * far * near) / (near - far)
  return m
}

describe('projectToScreen', () => {
  it('projects a point in front of the camera to the centre of the screen', () => {
    const cam = CAM_IDENTITY
    const proj = perspectiveMatrix(Math.PI / 4, 1, 0.1, 100)
    // A point at (0, 0, -10) is directly in front of the camera.
    const result = projectToScreen([0, 0, -10], cam as unknown as readonly number[], proj as unknown as readonly number[])
    expect(result).not.toBeNull()
    const [sx, sy] = result!
    expect(sx).toBeCloseTo(0.5, 4)
    expect(sy).toBeCloseTo(0.5, 4)
  })

  it('returns null for a point behind the camera', () => {
    const cam = CAM_IDENTITY
    const proj = perspectiveMatrix(Math.PI / 4, 1, 0.1, 100)
    const result = projectToScreen([0, 0, 10], cam as unknown as readonly number[], proj as unknown as readonly number[])
    expect(result).toBeNull()
  })

  it('projects a point to the right of the camera to the right side of the screen', () => {
    const cam = CAM_IDENTITY
    const proj = perspectiveMatrix(Math.PI / 4, 1, 0.1, 100)
    // A point at (5, 0, -10) is to the right.
    const result = projectToScreen([5, 0, -10], cam as unknown as readonly number[], proj as unknown as readonly number[])
    expect(result).not.toBeNull()
    const [sx] = result!
    expect(sx).toBeGreaterThan(0.5)
  })
})

describe('dockOnOval', () => {
  it('places a rightward direction on the right side of the oval', () => {
    const [x, y] = dockOnOval(1, 0)
    expect(x).toBeCloseTo(DOCK_CENTER_X + DOCK_RADIUS_X, 4)
    expect(y).toBeCloseTo(DOCK_CENTER_Y, 4)
  })

  it('places a leftward direction on the left side of the oval', () => {
    const [x, y] = dockOnOval(-1, 0)
    expect(x).toBeCloseTo(DOCK_CENTER_X - DOCK_RADIUS_X, 4)
    expect(y).toBeCloseTo(DOCK_CENTER_Y, 4)
  })

  it('places an upward direction on the top of the oval', () => {
    const [x, y] = dockOnOval(0, -1) // negative Y is up in screen coordinates
    expect(x).toBeCloseTo(DOCK_CENTER_X, 4)
    expect(y).toBeCloseTo(DOCK_CENTER_Y - DOCK_RADIUS_Y, 4)
  })

  it('returns the centre for a zero direction', () => {
    const [x, y] = dockOnOval(0, 0)
    expect(x).toBeCloseTo(DOCK_CENTER_X, 4)
    expect(y).toBeCloseTo(DOCK_CENTER_Y, 4)
  })
})

describe('navpointScreenPosition', () => {
  it('returns the projected position for an on-screen point', () => {
    const cam = CAM_IDENTITY
    const proj = perspectiveMatrix(Math.PI / 4, 1, 0.1, 100)
    const result = navpointScreenPosition([0, 0, -10], cam as unknown as readonly number[], proj as unknown as readonly number[], 1280, 720)
    expect(result.docked).toBe(false)
    expect(result.x).toBeCloseTo(640, 1)
    expect(result.y).toBeCloseTo(360, 1)
  })

  it('docks a behind-the-camera point on the oval in the mirrored direction', () => {
    const cam = CAM_IDENTITY
    const proj = perspectiveMatrix(Math.PI / 4, 1, 0.1, 100)
    // A point at (0, 0, 10) is behind the camera (camera looks down -Z).
    const result = navpointScreenPosition([0, 0, 10], cam as unknown as readonly number[], proj as unknown as readonly number[], 1280, 720)
    expect(result.docked).toBe(true)
    // The mirrored direction should place it somewhere on the oval.
    expect(result.x).toBeGreaterThan(0)
    expect(result.x).toBeLessThan(1280)
    expect(result.y).toBeGreaterThan(0)
    expect(result.y).toBeLessThan(720)
  })

  it('docks an off-screen-right point on the right side of the oval', () => {
    const cam = CAM_IDENTITY
    const proj = perspectiveMatrix(Math.PI / 4, 1, 0.1, 100)
    // A point far to the right: (50, 0, -10) projects well off the right edge.
    const result = navpointScreenPosition([50, 0, -10], cam as unknown as readonly number[], proj as unknown as readonly number[], 1280, 720)
    expect(result.docked).toBe(true)
    // Should be on the right side of the oval.
    expect(result.x).toBeGreaterThan(640)
  })
})
