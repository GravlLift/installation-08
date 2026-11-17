// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { zoneOutlineGeometry, zoneWallGeometry } from './zoneOutline3d'

describe('zone outlines', () => {
  it.each(['box', 'cylinder'] as const)('%s stays in the ground plane and leaves the center empty', (family) => {
    const geometry = zoneOutlineGeometry(family)
    const p = geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      expect(Math.abs(p.getY(i))).toBeLessThan(0.00001)
      expect(Math.hypot(p.getX(i), p.getZ(i))).toBeGreaterThan(0.4)
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, -1, 0))
    expect(ray.intersectObject(mesh)).toHaveLength(0)
    ray.ray.origin.x = family === 'box' ? 0.49 : 0.99
    expect(ray.intersectObject(mesh).length).toBeGreaterThan(0)
  })
})

describe('zone walls', () => {
  it.each(['box', 'cylinder'] as const)('%s does not close the center and draws its edges', (family) => {
    const mesh = new THREE.Mesh(zoneWallGeometry(family), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
    const down = new THREE.Raycaster(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, -1, 0))
    expect(down.intersectObject(mesh)).toHaveLength(0)
    const side = new THREE.Raycaster(new THREE.Vector3(2, 0.5, 0), new THREE.Vector3(-1, 0, 0))
    expect(side.intersectObject(mesh).length).toBeGreaterThan(0)
  })
})