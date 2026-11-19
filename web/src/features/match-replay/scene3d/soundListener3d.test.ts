// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { listenerOfCamera } from './soundListener3d'

describe('listenerOfCamera', () => {
  it('translates three position (4, 9, -7) into map position (4, 7, 9) for a look toward -Z', () => {
    const cam = new THREE.PerspectiveCamera()
    cam.position.set(4, 9, -7)
    cam.lookAt(4, 9, -8)
    expect(listenerOfCamera(cam)).toEqual({ x: 4, y: 7, z: 9, heading: 90 })
  })

  it('gives heading 0 to a look toward +X', () => {
    const cam = new THREE.PerspectiveCamera()
    cam.position.set(4, 9, -7)
    cam.lookAt(5, 9, -7)
    const l = listenerOfCamera(cam)
    expect(l.x).toBe(4)
    expect(l.y).toBe(7)
    expect(l.heading).toBeCloseTo(0)
  })
})
