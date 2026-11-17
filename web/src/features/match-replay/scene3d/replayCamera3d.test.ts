// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** replayCamera3d.test.ts — vérifie les états suivis et la hauteur mesurée sur le sol. */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { measureOriginAboveFloor, ReplayCamera3d } from './replayCamera3d'
import type { MapModel } from './mapModel'
import type { Tracks3d } from './tracks3d'

describe('ReplayCamera3d', () => {
  it('choisit la vie courante, la dernière vie ou la première apparition', () => {
    const point = { x: 0, y: 0, z: 1, h: 0, p: 0, crouch: false, slot: 1 }
    const tracks = {
      sample: (_xuid: string, frame: number) => frame === 2 ? point : null,
      lastLifeBefore: (_xuid: string, frame: number) => frame > 2 ? point : null,
      firstLifeAfter: () => point,
    } as unknown as Tracks3d
    const placement = new ReplayCamera3d({ tracks, povXuid: 'A', mode: 'fp', action: null, originAboveFloor: 0, camera: new THREE.PerspectiveCamera(), pickables: () => [], raycaster: new THREE.Raycaster() })
    expect(placement.povState(1)).toEqual({ state: point, status: 'unspawned' })
    expect(placement.povState(2)).toEqual({ state: point, status: 'alive' })
    expect(placement.povState(3)).toEqual({ state: point, status: 'dead' })
  })

  it('mesure la médiane des hauteurs sur les surfaces de la carte', () => {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial())
    floor.rotation.x = -Math.PI / 2
    floor.updateMatrixWorld()
    const model = { pickables: [floor] } as unknown as MapModel
    const points = [0.5, 1, 1.5].map((z) => ({ x: 0, y: 0, z }))
    expect(measureOriginAboveFloor(points, model, new THREE.Raycaster())).toBeCloseTo(1)
    expect(measureOriginAboveFloor(points, null, new THREE.Raycaster())).toBe(0)
  })
})
