import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { dropTriangles, markerBoxes } from './markerObjects3d'

/** Deux triangles : l'un autour de (1, 2, 3) en axes du jeu, l'autre loin. */
function geometrie(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  // Axes three : jeu (x, y, z) = three (x, z, -y).
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    1, 3, -2, 1.1, 3, -2, 1, 3.1, -2,
    9, 9, 9, 9.1, 9, 9, 9, 9.1, 9,
  ], 3))
  g.setIndex([0, 1, 2, 3, 4, 5])
  return g
}

describe('markerBoxes', () => {
  it('ne garde que les types repères, signés ou non', () => {
    const boxes = markerBoxes([
      { index: 1, type: -381729683, min: [0, 0, 0], max: [1, 1, 1] },
      { index: 2, type: 0xe93f446d, min: [0, 0, 0], max: [1, 1, 1] },
      { index: 3, type: 42, min: [0, 0, 0], max: [1, 1, 1] },
    ])
    expect(boxes).toHaveLength(2)
  })

  it('keeps the weapon rack, whose real kit the layer draws', () => {
    expect(markerBoxes([{ index: 1, type: 1649659840, min: [0, 0, 0], max: [1, 1, 1] }])).toEqual([])
  })

  it('rend une liste vide sans table', () => {
    expect(markerBoxes(undefined)).toEqual([])
  })
})

describe('dropTriangles', () => {
  it('retire le triangle dans la boîte du repère et garde les autres', () => {
    const g = geometrie()
    const boxes = markerBoxes([{ index: 1, type: -381729683, min: [0.9, 1.9, 2.9], max: [1.2, 2.1, 3.2] }])
    expect(dropTriangles(g, new THREE.Matrix4(), boxes)).toBe(1)
    expect(Array.from(g.index!.array)).toEqual([3, 4, 5])
  })

  it('ne touche à rien sans boîte', () => {
    const g = geometrie()
    expect(dropTriangles(g, new THREE.Matrix4(), [])).toBe(0)
    expect(g.index!.count).toBe(6)
  })
})
