// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloneMaterial } from './cloneMaterial3d'

describe('cloneMaterial', () => {
  afterEach(() => vi.restoreAllMocks())

  it('copies a material whose userData holds textures without serializing them', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const asg = new THREE.CompressedTexture([], 4, 4)
    const m = new THREE.MeshStandardMaterial({ roughness: 0.3 })
    m.userData = { armorMaps: { asg, mask0: null }, style: 'a1', flags: { glass: true } }
    const copy = cloneMaterial(m)
    expect(warn).not.toHaveBeenCalled()
    expect(copy).not.toBe(m)
    expect(copy.roughness).toBe(0.3)
    expect(copy.userData.armorMaps.asg).toBe(asg)
    expect(copy.userData.style).toBe('a1')
    // The source keeps its own userData; the copy's top level is its own object.
    expect(m.userData.armorMaps.asg).toBe(asg)
    copy.userData.extra = 1
    expect(m.userData.extra).toBeUndefined()
  })

  it('is what three.js would warn about otherwise', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = new THREE.MeshStandardMaterial()
    m.userData = { armorMaps: { asg: new THREE.CompressedTexture([], 4, 4) } }
    m.clone()
    expect(warn).toHaveBeenCalledWith('THREE.Texture: Unable to serialize Texture.')
  })
})
