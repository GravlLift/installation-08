import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { captureSkyScale, ENV_INTENSITY, farthestCorner, glowLevel, hazeDensity, SKY_FILL_SHARE, sunLightColor } from './lighting'

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

describe('sunLightColor', () => {
  const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b
  const tint = new THREE.Color(0xfff4e5)
  it('keeps the tuned sun for Recharge’s own color and SUN_TINT without one', () => {
    const recharge = sunLightColor([1, 0.9098039, 0.8039216])
    expect(Math.abs(recharge.r - tint.r) + Math.abs(recharge.g - tint.g) + Math.abs(recharge.b - tint.b)).toBeLessThan(0.03)
    expect(sunLightColor(null).equals(tint)).toBe(true)
    expect(sunLightColor([0, 0, 0]).equals(tint)).toBe(true)
  })
  it('takes Origin’s warm orange hue at the tuned luminance', () => {
    const origin = sunLightColor([1, 0.712, 0.41])
    expect(lum(origin)).toBeCloseTo(lum(tint), 6)
    expect(origin.g / origin.r).toBeCloseTo(0.712, 6)
    expect(origin.b / origin.r).toBeCloseTo(0.41, 6)
  })
})

describe('hazeDensity', () => {
  it('keeps the native haze when the layer stays inside the play area', () => {
    expect(hazeDensity(60, 60)).toBe(0.02)
    expect(hazeDensity(60, 40)).toBe(0.02)
    expect(hazeDensity(0, 400)).toBe(0.02)
  })
  it('thins the haze so a farther layer edge takes the haze the play area edge took', () => {
    // Origin: the play area reaches about 60 u, its Forge backdrop about 570 u.
    const d = hazeDensity(60, 570)
    const haze = (density: number, u: number) => 1 - Math.exp(-((density * u) ** 2))
    expect(haze(d, 570)).toBeCloseTo(haze(0.02, 60), 6)
    expect(haze(0.02, 100)).toBeGreaterThan(0.98)
    expect(haze(d, 100)).toBeLessThan(0.1)
  })
  it('measures a world from the play area center', () => {
    const box = new THREE.Box3(new THREE.Vector3(-3, -1, -4), new THREE.Vector3(1, 2, 2))
    expect(farthestCorner(box, new THREE.Vector3())).toBeCloseTo(Math.hypot(3, 2, 4), 6)
    expect(farthestCorner(new THREE.Box3(), new THREE.Vector3())).toBe(0)
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
