// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { FLASH_POOL, FlashLights, flashCurve } from './flash3d'

describe('flashCurve', () => {
  it('full at the start, decaying, off at the end, zero before the start', () => {
    expect(flashCurve(-0.001, 0.1)).toBe(0)
    expect(flashCurve(0, 0.1)).toBe(1)
    let last = 1
    for (let age = 0.01; age < 0.1; age += 0.01) {
      const k = flashCurve(age, 0.1)
      expect(k).toBeLessThan(last)
      expect(k).toBeGreaterThan(0)
      last = k
    }
    expect(flashCurve(0.1, 0.1)).toBe(0)
  })
})

describe('FlashLights', () => {
  const lightsOf = (scene: THREE.Scene) => {
    const out: THREE.PointLight[] = []
    scene.traverse((o) => {
      if (o instanceof THREE.PointLight) out.push(o)
    })
    return out
  }

  it('places a fixed set of off lights, with no shadow', () => {
    const scene = new THREE.Scene()
    new FlashLights(scene)
    const lights = lightsOf(scene)
    expect(lights).toHaveLength(FLASH_POOL)
    expect(lights.every((l) => l.intensity === 0 && !l.castShadow)).toBe(true)
  })

  it('gives the slots to the frame\'s strongest flashes, turns off the rest the next frame', () => {
    const scene = new THREE.Scene()
    const flashes = new FlashLights(scene)
    const white = new THREE.Color(1, 1, 1)
    flashes.begin()
    for (let i = 1; i <= FLASH_POOL + 3; i++) flashes.add(new THREE.Vector3(i, 0, 0), white, i, 2)
    flashes.end()
    const on = lightsOf(scene).map((l) => l.intensity).sort((a, b) => b - a)
    expect(on).toEqual([7, 6, 5, 4])
    flashes.begin()
    flashes.add(new THREE.Vector3(), white, 1, 2)
    flashes.end()
    expect(flashes.lit()).toBe(1)
  })

  it('removes its lights from the scene on release', () => {
    const scene = new THREE.Scene()
    new FlashLights(scene).dispose()
    expect(lightsOf(scene)).toHaveLength(0)
  })
})
