// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { flyDelta } from './freeFly3d'

describe('flyDelta', () => {
  const ahead = new THREE.Vector3(0, 0, -1)

  it('avance le long de la visée, à 4 unités par seconde', () => {
    const d = flyDelta(new Set(['KeyW']), ahead, 0.05, false)!
    expect(d.z).toBeCloseTo(-0.2)
    expect(d.x).toBeCloseTo(0)
  })

  it('glisse à droite, monte, et Maj triple la vitesse', () => {
    expect(flyDelta(new Set(['KeyD']), ahead, 0.05, false)!.x).toBeCloseTo(0.2)
    expect(flyDelta(new Set(['KeyE']), ahead, 0.05, true)!.y).toBeCloseTo(0.6)
  })

  it('une diagonale va à la même vitesse, deux touches opposées ne bougent pas', () => {
    expect(flyDelta(new Set(['KeyW', 'KeyD']), ahead, 0.05, false)!.length()).toBeCloseTo(0.2)
    expect(flyDelta(new Set(['KeyW', 'KeyS']), ahead, 0.05, false)).toBeNull()
    expect(flyDelta(new Set(['KeyK']), ahead, 0.05, false)).toBeNull()
  })

  it('un saut d image ne téléporte pas : le pas est plafonné', () => {
    expect(flyDelta(new Set(['KeyW']), ahead, 5, false)!.length()).toBeCloseTo(0.4)
  })
})
