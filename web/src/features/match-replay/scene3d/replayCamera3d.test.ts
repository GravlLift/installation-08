// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** replayCamera3d.test.ts — checks the tracked states and the height measured on the floor. */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { measureOriginAboveFloor, ReplayCamera3d } from './replayCamera3d'
import type { Tracks3d } from './tracks3d'

describe('ReplayCamera3d', () => {
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

  it('measures the median of the heights over the given surfaces', () => {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial())
    floor.rotation.x = -Math.PI / 2
    floor.updateMatrixWorld()
    const points = [0.5, 1, 1.5].map((z) => ({ x: 0, y: 0, z }))
    expect(measureOriginAboveFloor(points, [floor], new THREE.Raycaster())).toBeCloseTo(1)
    expect(measureOriginAboveFloor(points, [], new THREE.Raycaster())).toBe(0)
  })

  it('lands on the layer floor, not the canvas ground beneath it', () => {
    // A Forge map: the canvas ground (the map) is far under the spawn (beyond the 2u reach), and
    // the layer carries the real floor the players stand on. Measuring the map alone would drop
    // them to nothing (the ground is out of reach) or, when the ground is within reach, to it;
    // the layer floor must win as the nearest surface.
    const canvasGround = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial())
    canvasGround.rotation.x = -Math.PI / 2
    canvasGround.position.y = -0.98 // 1.48u below the spawn (origin at three y 0.5), within the ray's 2u reach
    canvasGround.updateMatrixWorld()
    const layerFloor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial())
    layerFloor.rotation.x = -Math.PI / 2
    layerFloor.position.y = 0.43 // 0.07u below the spawn: the floor the players actually stand on
    layerFloor.updateMatrixWorld()
    const points = [{ x: 0, y: 0, z: 0.5 }]
    // Map alone: the ray reaches the canvas ground and reports a 1.48u drop (the bug).
    expect(measureOriginAboveFloor(points, [canvasGround], new THREE.Raycaster())).toBeCloseTo(1.48)
    // Map plus layer: the nearest surface is the layer floor, a 0.07u drop.
    expect(measureOriginAboveFloor(points, [canvasGround, layerFloor], new THREE.Raycaster())).toBeCloseTo(0.07)
  })
})
