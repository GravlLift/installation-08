// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { dropTriangles, markerBoxes } from './markerObjects3d'

/** Two triangles: one around (1, 2, 3) in game axes, the other far away. */
function geometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  // three axes: game (x, y, z) = three (x, z, -y).
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    1, 3, -2, 1.1, 3, -2, 1, 3.1, -2,
    9, 9, 9, 9.1, 9, 9, 9, 9.1, 9,
  ], 3))
  g.setIndex([0, 1, 2, 3, 4, 5])
  return g
}

describe('markerBoxes', () => {
  it('keeps only marker types, signed or not', () => {
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

  it('returns an empty list with no table', () => {
    expect(markerBoxes(undefined)).toEqual([])
  })
})

describe('dropTriangles', () => {
  it('removes the triangle inside the marker box and keeps the others', () => {
    const g = geometry()
    const boxes = markerBoxes([{ index: 1, type: -381729683, min: [0.9, 1.9, 2.9], max: [1.2, 2.1, 3.2] }])
    expect(dropTriangles(g, new THREE.Matrix4(), boxes)).toBe(1)
    expect(Array.from(g.index!.array)).toEqual([3, 4, 5])
  })

  it('touches nothing with no box', () => {
    const g = geometry()
    expect(dropTriangles(g, new THREE.Matrix4(), [])).toBe(0)
    expect(g.index!.count).toBe(6)
  })
})
