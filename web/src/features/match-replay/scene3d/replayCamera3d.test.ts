// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** replayCamera3d.test.ts — checks the tracked states and the height measured on the floor. */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { measureOriginAboveFloor, ReplayCamera3d } from './replayCamera3d'
import type { MapModel } from './mapModel'
import type { Tracks3d } from './tracks3d'

describe('ReplayCamera3d', () => {
  it('pulls the camera behind an occupied vehicle even in first-person mode', () => {
    const point = { x: 0, y: 0, z: 0, h: 0, p: 0, crouch: false, slot: 1 }
    const tracks = { sample: () => point } as unknown as Tracks3d
    const camera = new THREE.PerspectiveCamera()
    const action = { riderAt: () => new THREE.Vector3(0, 0, 0), riderHeadingAt: () => 0 }
    const placement = new ReplayCamera3d({ tracks, povXuid: 'A', mode: 'fp', action: action as never, originAboveFloor: 0, camera, pickables: () => [], raycaster: new THREE.Raycaster() })
    placement.placeCamera(10)
    expect(camera.position.x).toBeLessThan(-0.5)
  })
  it('picks the current life, the last life, or the first spawn', () => {
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

  it('measures the median of the heights over the map\'s surfaces', () => {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial())
    floor.rotation.x = -Math.PI / 2
    floor.updateMatrixWorld()
    const model = { pickables: [floor] } as unknown as MapModel
    const points = [0.5, 1, 1.5].map((z) => ({ x: 0, y: 0, z }))
    expect(measureOriginAboveFloor(points, model, new THREE.Raycaster())).toBeCloseTo(1)
    expect(measureOriginAboveFloor(points, null, new THREE.Raycaster())).toBe(0)
  })
})
