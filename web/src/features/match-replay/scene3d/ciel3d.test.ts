// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { creerCiel, lireCiel, intensiteSoleil } from './ciel3d'

describe('lireCiel', () => {
  it('brings the declared light back to a full-daylight sun, with a fallback for old files', () => {
    expect(intensiteSoleil({ levelupSun: { intensity: 9 } })).toBe(1)
    // Origin (Forge, fo08_wetland): sun 2, full daylight in game.
    expect(intensiteSoleil({ levelupSun: { intensity: 2 } })).toBe(1)
    expect(intensiteSoleil({ levelupSun: { intensity: 1 } })).toBeCloseTo(0.5)
    // Streets: sun 0.05, night.
    expect(intensiteSoleil({ levelupSun: { intensity: 0.05 } })).toBeCloseTo(0.05 / 2)
    expect(intensiteSoleil({ ciel: { sunIntensity: 0 } })).toBe(0)
    expect(intensiteSoleil({})).toBe(1)
  })
  it('keeps the fallback for old GLBs and validates the texture', () => {
    expect(lireCiel({})).toBeNull()
    expect(lireCiel({ ciel: {} })).toEqual({ texture: null, color: null })
    expect(lireCiel({ ciel: { cloudTexture: 3 }, levelupSun: { color: [1, 0.9, 0.8] } })).toEqual({ texture: 3, color: [1, 0.9, 0.8] })
    expect(lireCiel({ ciel: { cloudTexture: -1 }, levelupSun: { color: [1, 'x', 0] } })).toEqual({ texture: null, color: null })
  })
  it('places the sun on three.js axes and keeps the sky out of depth and fog', () => {
    const texture = new THREE.Texture()
    const sky = creerCiel({ azimuth: 90, elevation: 30 }, texture, [1, 0.9, 0.8], 1)
    expect(sky.material.uniforms.sunPosition.value.toArray()).toEqual(expect.arrayContaining([expect.any(Number)]))
    expect(sky.material.uniforms.sunPosition.value.y).toBeCloseTo(225000)
    expect(sky.material.uniforms.sunPosition.value.z).toBeLessThan(0)
    expect(sky.material.uniforms.sunColor.value.toArray()).toEqual([1, 0.9, 0.8])
    expect(sky.material.depthTest).toBe(false)
    expect(sky.material.depthWrite).toBe(false)
    expect(sky.material.fog).toBe(false)
    expect(sky.material.uniforms.cloudMask.value).toBe(texture)
    sky.geometry.dispose()
    sky.material.dispose()
    texture.dispose()
  })
  it('darkens the sky and clouds according to the map\'s direct light', () => {
    const night = creerCiel({ azimuth: 0, elevation: 10 }, new THREE.Texture(), null, 0.05 / 8)
    expect(night.material.uniforms.daylight.value).toBeCloseTo(0.05 / 8)
    expect(night.material.fragmentShader.match(/retColor, daylight\), 1\.0 \);/g)).toHaveLength(1)
    expect(creerCiel({ azimuth: 0, elevation: 10 }, null, null, 4).material.uniforms.daylight.value).toBe(1)
  })
})
