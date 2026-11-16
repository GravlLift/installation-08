import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { BLOOM_THRESHOLD } from './bloom3d'
import { captureSkyScale, ENV_INTENSITY, glowLevel, IMAGE_GLOW_MAX, imageGlowLevel, SKY_FILL_SHARE } from './lighting'

describe('captureSkyScale', () => {
  const sky = new THREE.Color(0x9fb4c8)
  const luminance = 0.2126 * sky.r + 0.7152 * sky.g + 0.0722 * sky.b
  it('lights an open-sky surface with a share of the sun’s diffuse light', () => {
    const sun = 3.2 * (5 / 8) // Fortress: intensity 5 against the reference 8
    const fill = luminance * captureSkyScale(sun, sky) * ENV_INTENSITY
    expect(fill).toBeCloseTo((SKY_FILL_SHARE * sun) / Math.PI, 6)
    expect(captureSkyScale(sun, sky)).toBeLessThan(0.3)
  })
  it('follows the sun, never brightens the background, and stays dark without sky or sun', () => {
    expect(captureSkyScale(0.8, sky)).toBeLessThan(captureSkyScale(2, sky))
    expect(captureSkyScale(1000, sky)).toBe(1)
    expect(captureSkyScale(2, new THREE.Color(0x000000))).toBe(0)
    expect(captureSkyScale(0, sky)).toBe(0)
  })
})

describe('glowLevel', () => {
  it('comprime les forces du jeu sans en inverser l’ordre', () => {
    const forces = [0, 1, 5, 56, 400, 2000]
    const levels = forces.map(glowLevel)
    expect(levels[0]).toBe(0)
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThan(levels[i - 1])
    // 2 000 fois plus fort dans le jeu, moins de 15 fois plus fort à l'écran.
    expect(glowLevel(2000) / glowLevel(1)).toBeLessThan(15)
  })
})

describe('imageGlowLevel', () => {
  it('follows glowLevel for a dim picture and stops under the bloom threshold', () => {
    expect(imageGlowLevel(1)).toBeCloseTo(glowLevel(1))
    expect(imageGlowLevel(5)).toBe(IMAGE_GLOW_MAX)
    expect(imageGlowLevel(800)).toBe(IMAGE_GLOW_MAX)
    expect(IMAGE_GLOW_MAX).toBeLessThan(BLOOM_THRESHOLD)
    expect(imageGlowLevel(-1)).toBe(0)
  })
})
