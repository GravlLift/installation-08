// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { geometryPerMaterial } from './mapModel'

describe('geometryPerMaterial', () => {
  it('keeps one geometry per material, sharing the buffers, so per-material writes stay apart', () => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3))
    g.setIndex([0, 1, 2])
    const red = new THREE.MeshStandardMaterial()
    const white = new THREE.MeshStandardMaterial()
    const of = geometryPerMaterial()
    expect(of(g, red)).toBe(g)
    expect(of(g, red)).toBe(g) // another placement of the same mesh and material
    const w = of(g, white)
    expect(w).not.toBe(g)
    expect(of(g, white)).toBe(w)
    expect(w.getAttribute('position')).toBe(g.getAttribute('position'))
    expect(w.index).toBe(g.index)
    // The merge's per-material index no longer leaks into the other copy.
    w.setIndex([2, 1, 0])
    expect(Array.from(g.index!.array)).toEqual([0, 1, 2])
  })
})
