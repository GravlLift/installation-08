import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { DARK_GLASS, DARK_METAL, darkMetalFallback } from './fallbackMetal3d'

describe('darkMetalFallback', () => {
  it('donne le métal sombre à un matériau sans texture', () => {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(1, 1, 1), metalness: 0, roughness: 1 })
    expect(darkMetalFallback(m)).toBe(true)
    expect(m.color.r).toBeCloseTo(DARK_METAL.r)
    expect(m.metalness).toBe(DARK_METAL.metalness)
    expect(m.roughness).toBe(DARK_METAL.roughness)
  })

  it('donne le verre sombre opaque à un matériau translucide sans texture', () => {
    const glass = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.4 })
    expect(darkMetalFallback(glass)).toBe(true)
    expect(glass.color.r).toBeCloseTo(DARK_GLASS.r)
    expect(glass.roughness).toBe(DARK_GLASS.roughness)
    expect(glass.transparent).toBe(false)
    expect(glass.opacity).toBe(1)
  })

  it('laisse un matériau texturé ou lumineux', () => {
    const textured = new THREE.MeshStandardMaterial({ map: new THREE.Texture() })
    const light = new THREE.MeshStandardMaterial({ emissive: new THREE.Color(0, 1, 0), emissiveIntensity: 2 })
    for (const m of [textured, light]) {
      expect(darkMetalFallback(m)).toBe(false)
      expect(m.color.r).toBe(1)
    }
    expect(darkMetalFallback(new THREE.MeshBasicMaterial())).toBe(false)
  })
})
