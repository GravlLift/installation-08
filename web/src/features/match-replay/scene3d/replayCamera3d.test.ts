// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/** replayCamera3d.test.ts — checks the tracked states and the height measured on the floor. */
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { measureOriginAboveFloor, ReplayCamera3d } from './replayCamera3d'
import type { CameraScript } from './cameraScript3d'
import type { Tracks3d } from './tracks3d'

describe('ReplayCamera3d', () => {
  it('pulls the camera behind an occupied vehicle even in first-person mode', () => {
    const point = { x: 0, y: 0, z: 0, h: 0, p: 0, crouch: false, slot: 1 }
    const tracks = { sample: () => point } as unknown as Tracks3d
    const camera = new THREE.PerspectiveCamera()
    const action = { riderAt: () => new THREE.Vector3(0, 0, 0), riderHeadingAt: () => 0 }
    const placement = new ReplayCamera3d({ tracks, povXuid: 'A', mode: 'fp', action: action as never, originAboveFloor: 0, camera, subjects: { feetAt: () => null }, gameFov: 100, pickables: () => [], raycaster: new THREE.Raycaster() })
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
    const placement = new ReplayCamera3d({ tracks, povXuid: 'A', mode: 'fp', action: null, originAboveFloor: 0, camera: new THREE.PerspectiveCamera(), subjects: { feetAt: () => null }, gameFov: 100, pickables: () => [], raycaster: new THREE.Raycaster() })
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

  it('a set script drives the free camera', () => {
    // A two-key world script in GAME coordinates (z up): the first key at [0,0,5] looking at the
    // origin is the pose at script time 0 (in three axes the eye is [0,5,0], looking straight down).
    const script: CameraScript = {
      version: 1,
      matchId: 'm',
      name: 's',
      keys: [
        { t: 0, pos: { at: 'world', point: [0, 0, 5] }, look: { at: 'world', point: [0, 0, 0] } },
        { t: 100, ease: 'cut', pos: { at: 'world', point: [10, 0, 5] }, look: { at: 'world', point: [10, 0, 0] } },
      ],
    }
    const point = { x: 0, y: 0, z: 0, h: 0, p: 0, crouch: false, slot: 1 }
    const tracks = { sample: () => point, lastLifeBefore: () => null, firstLifeAfter: () => null } as unknown as Tracks3d
    const camera = new THREE.PerspectiveCamera()
    const placement = new ReplayCamera3d({ tracks, povXuid: 'A', mode: 'free', action: null, originAboveFloor: 0, camera, subjects: { feetAt: () => null }, gameFov: 100, pickables: () => [], raycaster: new THREE.Raycaster() })
    placement.setScript(script)
    placement.setScriptTime(0)
    expect(placement.scripted()).toBe(true)
    expect(placement.placeCamera(10)).toBe('alive') // the pov status, unchanged
    expect(camera.position.x).toBeCloseTo(0)
    expect(camera.position.y).toBeCloseTo(5)
    expect(camera.position.z).toBeCloseTo(0)
    const direction = camera.getWorldDirection(new THREE.Vector3())
    expect(direction.x).toBeCloseTo(0)
    expect(direction.y).toBeCloseTo(-1)
    expect(direction.z).toBeCloseTo(0)
    expect(placement.lastScriptPose?.target[0]).toBeCloseTo(0)
    expect(placement.lastScriptPose?.target[1]).toBeCloseTo(0)
    expect(placement.lastScriptPose?.target[2]).toBeCloseTo(0)
  })

  it('a rolled key turns the frame clockwise', () => {
    const script: CameraScript = {
      version: 1,
      matchId: 'm',
      name: 's',
      keys: [{ t: 0, pos: { at: 'world', point: [0, 0, 5] }, look: { at: 'world', point: [0, 0, 0] }, roll: 90 }],
    }
    const camera = new THREE.PerspectiveCamera()
    const placement = new ReplayCamera3d({ tracks: null, povXuid: 'A', mode: 'free', action: null, originAboveFloor: 0, camera, subjects: { feetAt: () => null }, gameFov: 100, pickables: () => [], raycaster: new THREE.Raycaster() })
    placement.setScript(script)
    placement.setScriptTime(0)
    placement.placeCamera(10)
    // The camera's local up axis, in world axes, has been turned a quarter turn around its view direction.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)
    expect(up.x).toBeCloseTo(1)
    expect(up.y).toBeCloseTo(0)
    expect(up.z).toBeCloseTo(0)
  })

  it('a set script never moves a tracked camera', () => {
    const point = { x: 0, y: 0, z: 0, h: 0, p: 0, crouch: false, dropOeil: 0, slot: 1 }
    const tracks = { sample: () => point, lastLifeBefore: () => null, firstLifeAfter: () => null } as unknown as Tracks3d
    const camera = new THREE.PerspectiveCamera()
    const placement = new ReplayCamera3d({ tracks, povXuid: 'A', mode: 'tp', action: null, originAboveFloor: 0, camera, subjects: { feetAt: () => null }, gameFov: 100, pickables: () => [], raycaster: new THREE.Raycaster() })
    placement.setScript({ version: 1, matchId: 'm', name: 's', keys: [{ t: 0, pos: { at: 'world', point: [0, 0, 5] }, look: { at: 'world', point: [0, 0, 0] } }] })
    expect(placement.scripted()).toBe(false)
    placement.placeCamera(10)
    expect(placement.lastScriptPose).toBeNull()
    expect(camera.position.y).toBeCloseTo(0.82) // the third-person camera above the eye, not the script's key
  })

  it('exposes the active script and the set time', () => {
    const script: CameraScript = {
      version: 1,
      matchId: 'm',
      name: 's',
      keys: [{ t: 0, pos: { at: 'world', point: [0, 0, 5] }, look: { at: 'world', point: [0, 0, 0] } }],
    }
    const camera = new THREE.PerspectiveCamera()
    const placement = new ReplayCamera3d({ tracks: null, povXuid: 'A', mode: 'free', action: null, originAboveFloor: 0, camera, subjects: { feetAt: () => null }, gameFov: 100, pickables: () => [], raycaster: new THREE.Raycaster() })
    expect(placement.activeScript()).toBeNull()
    expect(placement.scriptTime()).toBe(0)
    placement.setScript(script)
    placement.setScriptTime(1234)
    expect(placement.activeScript()).toBe(script)
    expect(placement.scriptTime()).toBe(1234)
    // A script never drives a tracked camera, so it is not active there.
    const tracked = new ReplayCamera3d({ tracks: null, povXuid: 'A', mode: 'tp', action: null, originAboveFloor: 0, camera, subjects: { feetAt: () => null }, gameFov: 100, pickables: () => [], raycaster: new THREE.Raycaster() })
    tracked.setScript(script)
    expect(tracked.activeScript()).toBeNull()
    placement.setScript(null)
    expect(placement.activeScript()).toBeNull()
  })

  it('clearing the script stops the placement', () => {
    const script: CameraScript = {
      version: 1,
      matchId: 'm',
      name: 's',
      keys: [
        { t: 0, pos: { at: 'world', point: [0, 0, 5] }, look: { at: 'world', point: [0, 0, 0] } },
        { t: 100, ease: 'cut', pos: { at: 'world', point: [10, 0, 5] }, look: { at: 'world', point: [10, 0, 0] } },
      ],
    }
    const camera = new THREE.PerspectiveCamera()
    const placement = new ReplayCamera3d({ tracks: null, povXuid: 'A', mode: 'free', action: null, originAboveFloor: 0, camera, subjects: { feetAt: () => null }, gameFov: 100, pickables: () => [], raycaster: new THREE.Raycaster() })
    placement.setScript(script)
    placement.setScriptTime(0)
    placement.placeCamera(10)
    expect(camera.position.x).toBeCloseTo(0)
    expect(camera.position.y).toBeCloseTo(5)
    placement.setScript(null)
    expect(placement.scripted()).toBe(false)
    expect(placement.lastScriptPose).toBeNull()
    placement.setScriptTime(100) // a time the cleared script would have placed on its second key
    placement.placeCamera(10)
    expect(camera.position.x).toBeCloseTo(0) // the free camera keeps its last pose
    expect(camera.position.y).toBeCloseTo(5)
  })
})
