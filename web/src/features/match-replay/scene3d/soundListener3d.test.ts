import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { listenerOfCamera } from './soundListener3d'

describe('listenerOfCamera', () => {
  it('traduit la position three (4, 9, -7) en position de carte (4, 7) pour un regard vers -Z', () => {
    const cam = new THREE.PerspectiveCamera()
    cam.position.set(4, 9, -7)
    cam.lookAt(4, 9, -8)
    expect(listenerOfCamera(cam)).toEqual({ x: 4, y: 7, heading: 90 })
  })

  it('donne le cap 0 à un regard vers +X', () => {
    const cam = new THREE.PerspectiveCamera()
    cam.position.set(4, 9, -7)
    cam.lookAt(5, 9, -7)
    const l = listenerOfCamera(cam)
    expect(l.x).toBe(4)
    expect(l.y).toBe(7)
    expect(l.heading).toBeCloseTo(0)
  })
})
