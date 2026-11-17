// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { isSelfLit, lightSelfLit, MELANGE_ADDITIVE } from './selfLit3d'

/** The BR75's light strip as the library writes it (`illum`, additive, see-through placeholder). */
function strip(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0.6, 0.8, 1), transparent: true, opacity: 0.25,
    emissive: new THREE.Color(0, 0.178, 1), emissiveIntensity: 5, emissiveMap: new THREE.Texture(),
  })
  m.userData = { melange: MELANGE_ADDITIVE, shader: 0xfb43df97 }
  return m
}

describe('lightSelfLit', () => {
  it('draws an additive self-lit material as additive light at full opacity, keeping its light', () => {
    const m = strip()
    const map = m.emissiveMap
    expect(lightSelfLit(m)).toBe(true)
    expect(m.color.getHex()).toBe(0)
    expect(m.blending).toBe(THREE.AdditiveBlending)
    expect(m.transparent).toBe(true)
    expect(m.opacity).toBe(1)
    expect(m.depthWrite).toBe(false)
    expect(m.emissiveMap).toBe(map)
    expect(m.emissiveIntensity).toBe(5)
    expect(m.emissive.b).toBe(1)
    expect(lightSelfLit(m)).toBe(false) // once
  })

  it('keeps an opaque self-lit material opaque (the Needler needles)', () => {
    const m = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1, emissiveMap: new THREE.Texture() })
    m.userData = { melange: 0 }
    expect(lightSelfLit(m)).toBe(true)
    expect(m.color.getHex()).toBe(0)
    expect(m.blending).toBe(THREE.NormalBlending)
    expect(m.transparent).toBe(false)
  })

  it('leaves a lit surface with a color map, glass, a painted surface and a dark material', () => {
    const textured = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 1 })
    const glass = strip()
    glass.userData.vitre = true
    const painted = strip()
    painted.userData.surfaceBrute = {}
    const dark = new THREE.MeshStandardMaterial()
    const off = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0 })
    for (const m of [textured, glass, painted, dark, off]) {
      expect(isSelfLit(m)).toBe(false)
      expect(lightSelfLit(m)).toBe(false)
    }
    expect(lightSelfLit(new THREE.MeshBasicMaterial())).toBe(false)
  })
})
