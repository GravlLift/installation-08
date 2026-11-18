// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { clipOfRig, rigForWeapon, ROTATION_RIG_CAMERA, clipTime, type FirstPersonIndex } from './firstPersonRig3d'

const clip = { name: 'idle', action: 'idle', variant: 0, type: 'base', overlay: false, frameCount: 30, frameRate: 30, durationSeconds: 1 }
const rig = { file: 'rig.glb', bones: 1, triangles: 1, bytes: 1, clips: [clip], actions: [{ action: 'idle', variant: 0, clip: 'idle' }], missingActions: [] }
const index: FirstPersonIndex = { schema: 1, weapons: [{ weapon: 'abcdef12', file: rig.file }], rigs: [rig], failures: [], textures: {} }

describe('first person', () => {
  it('finds the rig by key, case-insensitively', () => {
    expect(rigForWeapon(index, 'ABCDEF12')).toBe(rig)
    expect(rigForWeapon(index, '12345678')).toBeNull()
    expect(rigForWeapon(index, null)).toBeNull()
  })
  it('finds the clip by its actions and variant', () => {
    expect(clipOfRig(rig, 'idle')).toBe(clip)
    expect(clipOfRig(rig, 'idle', 1)).toBeNull()
    expect(clipOfRig(rig, 'fire')).toBeNull()
  })
  it('computes a deterministic, looped time', () => {
    expect(clipTime(clip, 15, 10)).toBeCloseTo(0.5)
    expect(clipTime(clip, 5, 10)).toBeCloseTo(0.5)
    expect(clipTime(clip, -5, 10)).toBeCloseTo(0.5)
    expect(clipTime(clip, 5, 0)).toBe(0)
  })
  it('orients the rig\'s axes toward the camera\'s', () => {
    for (const [origin, expected] of [
      [[1, 0, 0], [0, 0, -1]], [[0, 0, 1], [1, 0, 0]], [[0, 1, 0], [0, 1, 0]],
    ]) {
      const result = new THREE.Vector3().fromArray(origin).applyQuaternion(ROTATION_RIG_CAMERA)
      expect(result.distanceTo(new THREE.Vector3().fromArray(expected))).toBeLessThan(1e-10)
    }
  })
})
