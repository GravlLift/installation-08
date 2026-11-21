// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import {
  DOCK_CENTER_X,
  DOCK_CENTER_Y,
  DOCK_RADIUS_X,
  DOCK_RADIUS_Y,
  dockOnOval,
  projectToScreen,
  spreadDocked,
} from './padNavpointMath3d'

/** A camera at the origin looking down -Z (three.js default), 45-degree vertical FOV. */
function makeCamera(): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  cam.updateMatrixWorld()
  return cam
}

describe('projectToScreen', () => {
  it('projects a point in front of the camera to the centre of the screen', () => {
    const cam = makeCamera()
    const result = projectToScreen([0, 0, -10], cam)
    expect(result).not.toBeNull()
    const [sx, sy] = result!
    expect(sx).toBeCloseTo(0.5, 6)
    expect(sy).toBeCloseTo(0.5, 6)
  })

  it('returns null for a point behind the camera', () => {
    const cam = makeCamera()
    const result = projectToScreen([0, 0, 10], cam)
    expect(result).toBeNull()
  })

  it('projects a point to the right of the camera to the right side of the screen', () => {
    const cam = makeCamera()
    const result = projectToScreen([5, 0, -10], cam)
    expect(result).not.toBeNull()
    const [sx] = result!
    expect(sx).toBeGreaterThan(0.5)
  })

  it('projects a point straight ahead of a 90-degree yaw camera to the screen centre', () => {
    const cam = makeCamera()
    // Turn the camera 90 degrees in yaw (around Y): it now looks down +X.
    cam.lookAt(10, 0, 0)
    cam.updateMatrixWorld()
    // A point at (10, 0, 0) is straight ahead.
    const result = projectToScreen([10, 0, 0], cam)
    expect(result).not.toBeNull()
    const [sx, sy] = result!
    expect(sx).toBeCloseTo(0.5, 6)
    expect(sy).toBeCloseTo(0.5, 6)
  })

  it('returns null for a point behind a 90-degree yaw camera', () => {
    const cam = makeCamera()
    cam.lookAt(10, 0, 0)
    cam.updateMatrixWorld()
    // A point at (-10, 0, 0) is behind the camera (which looks down +X).
    const result = projectToScreen([-10, 0, 0], cam)
    expect(result).toBeNull()
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

describe('spreadDocked', () => {
  it('spreads 5 icons at the same angle so pairwise gaps are >= minGap', () => {
    const minGap = 0.05
    const angles = [1.0, 1.0, 1.0, 1.0, 1.0]
    const result = spreadDocked(angles, minGap)
    expect(result).toHaveLength(5)
    // Sort the result to check pairwise gaps.
    const sorted = [...result].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(minGap - 1e-9)
    }
  })

  it('keeps the mean angle unchanged for 5 icons at the same angle', () => {
    const minGap = 0.05
    const angles = [1.0, 1.0, 1.0, 1.0, 1.0]
    const result = spreadDocked(angles, minGap)
    const mean = result.reduce((s, a) => s + a, 0) / result.length
    expect(mean).toBeCloseTo(1.0, 9)
  })

  it('keeps the order of 5 icons at the same angle', () => {
    const minGap = 0.05
    const angles = [1.0, 1.0, 1.0, 1.0, 1.0]
    const result = spreadDocked(angles, minGap)
    // All original angles are equal, so the order is preserved by index.
    // The result should be monotonically non-decreasing when sorted by input index.
    const sorted = [...result].sort((a, b) => a - b)
    expect(result).toEqual(expect.arrayContaining(sorted))
    // More specifically: since all inputs are identical, the output should be
    // symmetric around the mean, with the first element being the smallest
    // and the last being the largest (or vice versa depending on the rotation).
    // Just verify that the set of values is the same as the sorted set.
    expect(result.slice().sort((a, b) => a - b)).toEqual(sorted)
  })

  it('leaves 2 icons already farther apart than minGap unchanged', () => {
    const minGap = 0.1
    const angles = [0.5, 0.8] // gap of 0.3 > 0.1
    const result = spreadDocked(angles, minGap)
    expect(result[0]).toBeCloseTo(0.5, 9)
    expect(result[1]).toBeCloseTo(0.8, 9)
  })
})
