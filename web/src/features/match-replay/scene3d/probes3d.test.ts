// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { chooseProbes, nearestProbe, sunAngles } from './probes3d'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

describe('chooseProbes', () => {
  // Two rooms 40u apart, each with a few points.
  const room = (cx: number) => [v(cx, 0, 0), v(cx + 1, 0, 0), v(cx, 0, 1), v(cx - 1, 0, -1)]
  const points = [...room(0), ...room(40)]

  it('the first probe is the point closest to the center, the next in the farthest room', () => {
    const probes = chooseProbes(points, 8, 12)
    expect(probes).toHaveLength(2)
    expect(probes[1].x).toBeGreaterThan(30)
  })

  it('the cap bounds the probe count, so does the spacing', () => {
    expect(chooseProbes(points, 1, 12)).toHaveLength(1)
    expect(chooseProbes(points, 8, 100)).toHaveLength(1)
    expect(chooseProbes([], 8, 12)).toEqual([])
  })

  it('deterministic', () => {
    expect(chooseProbes(points, 8, 2)).toEqual(chooseProbes(points, 8, 2))
  })
})

describe('nearestProbe', () => {
  const probes = [v(0, 0, 0), v(20, 0, 0)]

  it('the probe closest to the box', () => {
    expect(nearestProbe(new THREE.Box3(v(15, 0, -1), v(17, 1, 1)), probes)).toBe(1)
  })

  it('a slab containing both probes is settled by its center', () => {
    expect(nearestProbe(new THREE.Box3(v(-5, -1, -1), v(30, 1, 1)), probes)).toBe(1)
    expect(nearestProbe(new THREE.Box3(v(-10, -1, -1), v(22, 1, 1)), probes)).toBe(0)
  })
})

describe('sunAngles', () => {
  it('converts the Halo direction to the scene\'s azimuth and elevation', () => {
    // Halo (1, 0, 1): toward +X, at 45 degrees; three.js (1, 1, 0): azimuth 0.
    const a = sunAngles({ levelupSun: { dir: [1, 0, 1] } })
    expect(a?.azimuth).toBeCloseTo(0)
    expect(a?.elevation).toBeCloseTo(45)
    // Halo horizontal +Y = three.js -Z = azimuth 90.
    expect(sunAngles({ levelupSun: { dir: [0, 1, 1] } })?.azimuth).toBeCloseTo(90)
  })

  it('absent, unreadable or below the horizon: null', () => {
    expect(sunAngles({})).toBeNull()
    expect(sunAngles(null)).toBeNull()
    expect(sunAngles({ levelupSun: { dir: [1, 0] } })).toBeNull()
    expect(sunAngles({ levelupSun: { dir: [1, 0, -1] } })).toBeNull()
    expect(sunAngles({ levelupSun: { dir: [1, 'a', 1] } })).toBeNull()
  })
})
