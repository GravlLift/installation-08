// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { cloakOpacity } from './avatar3d'
import { CamouflageRig3d } from './camouflageRig3d'

function rig() {
  const root = new THREE.Group()
  const arms = new THREE.MeshStandardMaterial()
  const glass = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false })
  root.add(new THREE.Mesh(new THREE.BufferGeometry(), arms), new THREE.Mesh(new THREE.BufferGeometry(), [glass]))
  return { root, arms, glass }
}

describe('CamouflageRig3d', () => {
  it('fades every material of the rig by the body rule, then gives each its own state back', () => {
    const { root, arms, glass } = rig()
    const camo = new CamouflageRig3d()
    camo.apply(root, 1)
    expect(arms).toMatchObject({ transparent: true, depthWrite: false })
    expect(arms.opacity).toBeCloseTo(cloakOpacity(1))
    expect(glass.opacity).toBeCloseTo(0.5 * cloakOpacity(1))
    camo.apply(root, 0.5)
    expect(arms.opacity).toBeCloseTo(cloakOpacity(0.5))
    camo.apply(root, 0)
    expect(arms).toMatchObject({ transparent: false, depthWrite: true, opacity: 1 })
    expect(glass).toMatchObject({ transparent: true, depthWrite: false, opacity: 0.5 })
  })

  it('restores the previous rig when another one takes the view, and does nothing without camo', () => {
    const a = rig()
    const b = rig()
    const camo = new CamouflageRig3d()
    camo.apply(b.root, 0)
    expect(b.arms.transparent).toBe(false)
    camo.apply(a.root, 1)
    camo.apply(b.root, 1)
    expect(a.arms).toMatchObject({ transparent: false, opacity: 1 })
    expect(b.arms.transparent).toBe(true)
    camo.apply(null, 1)
    expect(b.arms).toMatchObject({ transparent: false, opacity: 1 })
  })
})
