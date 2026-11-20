// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cloneMaterial } from './cloneMaterial3d'
import { FINITE_NORMAL, giveFiniteNormal } from './lighting'

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

  it('carries the vertex attribute defaults (the finite normal) that clone drops', () => {
    const m = new THREE.MeshStandardMaterial()
    giveFiniteNormal(m)
    // three's own clone loses it: the copy would read WebGL's generic (0, 0, 0) normal.
    expect((m.clone() as unknown as { defaultAttributeValues?: unknown }).defaultAttributeValues).toBeUndefined()
    const copy = cloneMaterial(m) as unknown as { defaultAttributeValues?: Record<string, readonly number[]> }
    expect(copy.defaultAttributeValues?.normal).toEqual(FINITE_NORMAL)
    expect(Math.hypot(...(copy.defaultAttributeValues?.normal ?? [0]))).toBeGreaterThan(0)
  })

  it('is what three.js would warn about otherwise', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const m = new THREE.MeshStandardMaterial()
    m.userData = { armorMaps: { asg: new THREE.CompressedTexture([], 4, 4) } }
    m.clone()
    expect(warn).toHaveBeenCalledWith('THREE.Texture: Unable to serialize Texture.')
  })
})
