// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { tightenBounds } from './mapModel'

describe('tightenBounds', () => {
  it("mesure les bornes sur les sommets de l'index, pas sur le tampon partagé", () => {
    // Deux triangles éloignés dans un même tampon ; la surface n'indexe que le premier.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 100, 100, 100, 101, 100, 100, 100, 101, 100])
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.setIndex([0, 1, 2])
    geometry.computeBoundingSphere()
    expect(geometry.boundingSphere!.radius).toBeGreaterThan(50)

    tightenBounds(geometry)
    expect(geometry.boundingBox!.max.toArray()).toEqual([1, 1, 0])
    expect(geometry.boundingSphere!.radius).toBeLessThan(1)
    expect(geometry.boundingSphere!.center.toArray()).toEqual([0.5, 0.5, 0])
  })

  it('laisse une géométrie sans index telle quelle', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
    tightenBounds(geometry)
    expect(geometry.boundingSphere).toBeNull()
  })
})
