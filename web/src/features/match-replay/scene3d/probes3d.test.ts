// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { chooseProbes, nearestProbe, sunAngles } from './probes3d'

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)

describe('chooseProbes', () => {
  // Deux salles éloignées de 40 u, chacune de quelques points.
  const room = (cx: number) => [v(cx, 0, 0), v(cx + 1, 0, 0), v(cx, 0, 1), v(cx - 1, 0, -1)]
  const points = [...room(0), ...room(40)]

  it('la première sonde est le point le plus proche du centre, la suivante dans la salle la plus loin', () => {
    const probes = chooseProbes(points, 8, 12)
    expect(probes).toHaveLength(2)
    expect(probes[1].x).toBeGreaterThan(30)
  })

  it('le plafond borne le nombre de sondes, l’espacement aussi', () => {
    expect(chooseProbes(points, 1, 12)).toHaveLength(1)
    expect(chooseProbes(points, 8, 100)).toHaveLength(1)
    expect(chooseProbes([], 8, 12)).toEqual([])
  })

  it('déterministe', () => {
    expect(chooseProbes(points, 8, 2)).toEqual(chooseProbes(points, 8, 2))
  })
})

describe('nearestProbe', () => {
  const probes = [v(0, 0, 0), v(20, 0, 0)]

  it('la sonde la plus proche de la boîte', () => {
    expect(nearestProbe(new THREE.Box3(v(15, 0, -1), v(17, 1, 1)), probes)).toBe(1)
  })

  it('une dalle qui contient les deux sondes départage par son centre', () => {
    expect(nearestProbe(new THREE.Box3(v(-5, -1, -1), v(30, 1, 1)), probes)).toBe(1)
    expect(nearestProbe(new THREE.Box3(v(-10, -1, -1), v(22, 1, 1)), probes)).toBe(0)
  })
})

describe('sunAngles', () => {
  it('convertit la direction Halo en azimut et élévation de la scène', () => {
    // Halo (1, 0, 1) : vers +X, à 45 degrés ; three (1, 1, 0) : azimut 0.
    const a = sunAngles({ levelupSun: { dir: [1, 0, 1] } })
    expect(a?.azimuth).toBeCloseTo(0)
    expect(a?.elevation).toBeCloseTo(45)
    // Halo +Y horizontal = three -Z = azimut 90.
    expect(sunAngles({ levelupSun: { dir: [0, 1, 1] } })?.azimuth).toBeCloseTo(90)
  })

  it('absente, illisible ou sous l’horizon : null', () => {
    expect(sunAngles({})).toBeNull()
    expect(sunAngles(null)).toBeNull()
    expect(sunAngles({ levelupSun: { dir: [1, 0] } })).toBeNull()
    expect(sunAngles({ levelupSun: { dir: [1, 0, -1] } })).toBeNull()
    expect(sunAngles({ levelupSun: { dir: [1, 'a', 1] } })).toBeNull()
  })
})
