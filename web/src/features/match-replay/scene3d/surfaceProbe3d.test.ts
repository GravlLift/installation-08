// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { formatProbe, objectAt, probeSurface, tagSurface } from './surfaceProbe3d'

function wall(z: number, name: string, visible = true, size = 10): THREE.Mesh {
  const source = new THREE.MeshStandardMaterial()
  source.name = name
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size),new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }))
  m.position.z = z
  m.visible = visible
  tagSurface(m, source, 0x377bfad9, 'structure')
  return m
}

describe('probeSurface', () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()

  it('names the game material of the first visible surface, in game coordinates', () => {
    const root = new THREE.Group()
    root.add(wall(5, 'mat_hidden', false), wall(2, 'mat_669f626c'), wall(-3, 'mat_behind'))
    root.updateMatrixWorld(true)
    const hit = probeSurface([root], camera, new THREE.Vector2(0, 0))
    expect(hit?.material).toBe('mat_669f626c')
    expect(hit?.shader).toBe('377bfad9')
    expect(hit?.halo[1]).toBeCloseTo(-2)
    expect(formatProbe(hit!)).toBe('mat_669f626c shader 377bfad9 structure @ (0.00, -2.00, 0.00)')
  })

  it('returns null outside the map', () => {
    const root = new THREE.Group()
    root.add(wall(2, 'mat_a', true, 1))
    root.updateMatrixWorld(true)
    expect(probeSurface([root], camera, new THREE.Vector2(0.99, 0.99))).toBeNull()
  })

  it('a layer placed on the map is inspected like it is: whichever surface is closer', () => {
    const map = new THREE.Group()
    map.add(wall(-1, 'mat_sol'))
    const layer = new THREE.Group()
    layer.add(wall(3, 'mat_caisse'))
    map.updateMatrixWorld(true)
    layer.updateMatrixWorld(true)
    expect(probeSurface([map, layer], camera, new THREE.Vector2(0, 0))?.material).toBe('mat_caisse')
    expect(probeSurface([map], camera, new THREE.Vector2(0, 0))?.material).toBe('mat_sol')
  })

  it('names the variant object whose box contains the hit point', () => {
    const layer = new THREE.Group()
    layer.add(wall(3, 'mat_caisse'))
    // The hit point is (0, 0, 3) in three.js: (0, -3, 0) in the game.
    layer.userData.levelupObjects = [
      { index: 4, type: 77, min: [-5, -9, -5], max: [5, 9, 5] },
      { index: 11, type: 1739378636, min: [-1, -3.5, -1], max: [1, -2.5, 1] },
    ]
    layer.updateMatrixWorld(true)
    const hit = probeSurface([layer], camera, new THREE.Vector2(0, 0))
    expect(hit?.object).toEqual({ index: 11, type: 1739378636 })
    expect(formatProbe(hit!)).toBe('mat_caisse shader 377bfad9 structure @ (0.00, -3.00, 0.00) object #11 type 1739378636')
  })
})

describe('objectAt', () => {
  const objects = [{ index: 2, type: 9, min: [0, 0, 0] as [number, number, number], max: [1, 1, 1] as [number, number, number] }]

  it('accepts a point on the box\'s face, rejects a point outside', () => {
    expect(objectAt(objects, [1.01, 0.5, 0.5])).toEqual({ index: 2, type: 9 })
    expect(objectAt(objects, [1.5, 0.5, 0.5])).toBeNull()
  })
})
