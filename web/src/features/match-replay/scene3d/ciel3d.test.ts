import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { creerCiel, lireCiel, intensiteSoleil } from './ciel3d'

describe('lireCiel', () => {
  it('ramène la lumière déclarée au soleil de plein jour, avec repli pour anciens fichiers', () => {
    expect(intensiteSoleil({ levelupSun: { intensity: 9 } })).toBe(1)
    expect(intensiteSoleil({ levelupSun: { intensity: 0.05 } })).toBeCloseTo(0.05 / 8)
    expect(intensiteSoleil({ ciel: { sunIntensity: 0 } })).toBe(0)
    expect(intensiteSoleil({})).toBe(1)
  })
  it('garde le repli pour les anciens GLB et valide la texture', () => {
    expect(lireCiel({})).toBeNull()
    expect(lireCiel({ ciel: {} })).toEqual({ texture: null, color: null })
    expect(lireCiel({ ciel: { cloudTexture: 3 }, levelupSun: { color: [1, 0.9, 0.8] } })).toEqual({ texture: 3, color: [1, 0.9, 0.8] })
    expect(lireCiel({ ciel: { cloudTexture: -1 }, levelupSun: { color: [1, 'x', 0] } })).toEqual({ texture: null, color: null })
  })
  it('place le soleil en axes three et garde le ciel hors profondeur et brouillard', () => {
    const texture = new THREE.Texture()
    const ciel = creerCiel({ azimuth: 90, elevation: 30 }, texture, [1, 0.9, 0.8], 1)
    expect(ciel.material.uniforms.sunPosition.value.toArray()).toEqual(expect.arrayContaining([expect.any(Number)]))
    expect(ciel.material.uniforms.sunPosition.value.y).toBeCloseTo(225000)
    expect(ciel.material.uniforms.sunPosition.value.z).toBeLessThan(0)
    expect(ciel.material.uniforms.sunColor.value.toArray()).toEqual([1, 0.9, 0.8])
    expect(ciel.material.depthTest).toBe(false)
    expect(ciel.material.depthWrite).toBe(false)
    expect(ciel.material.fog).toBe(false)
    expect(ciel.material.uniforms.cloudMask.value).toBe(texture)
    ciel.geometry.dispose()
    ciel.material.dispose()
    texture.dispose()
  })
  it('assombrit ciel et nuages selon la lumière directe de la carte', () => {
    const nuit = creerCiel({ azimuth: 0, elevation: 10 }, new THREE.Texture(), null, 0.05 / 8)
    expect(nuit.material.uniforms.jour.value).toBeCloseTo(0.05 / 8)
    expect(nuit.material.fragmentShader.match(/retColor, jour\), 1\.0 \);/g)).toHaveLength(1)
    expect(creerCiel({ azimuth: 0, elevation: 10 }, null, null, 4).material.uniforms.jour.value).toBe(1)
  })
})
