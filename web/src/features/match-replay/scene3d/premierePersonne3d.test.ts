// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { clipDuRig, rigDeLArme, ROTATION_RIG_CAMERA, tempsDuClip, type IndexPremierePersonne } from './premierePersonne3d'

const clip = { name: 'attente', action: 'idle', variant: 0, type: 'base', overlay: false, frameCount: 30, frameRate: 30, durationSeconds: 1 }
const rig = { file: 'rig.glb', bones: 1, triangles: 1, bytes: 1, clips: [clip], actions: [{ action: 'idle', variant: 0, clip: 'attente' }], missingActions: [] }
const index: IndexPremierePersonne = { schema: 1, weapons: [{ weapon: 'abcdef12', file: rig.file }], rigs: [rig], failures: [], textures: {} }

describe('first person', () => {
  it('finds the rig by key, case-insensitively', () => {
    expect(rigDeLArme(index, 'ABCDEF12')).toBe(rig)
    expect(rigDeLArme(index, '12345678')).toBeNull()
    expect(rigDeLArme(index, null)).toBeNull()
  })
  it('finds the clip by its actions and variant', () => {
    expect(clipDuRig(rig, 'idle')).toBe(clip)
    expect(clipDuRig(rig, 'idle', 1)).toBeNull()
    expect(clipDuRig(rig, 'fire')).toBeNull()
  })
  it('computes a deterministic, looped time', () => {
    expect(tempsDuClip(clip, 15, 10)).toBeCloseTo(0.5)
    expect(tempsDuClip(clip, 5, 10)).toBeCloseTo(0.5)
    expect(tempsDuClip(clip, -5, 10)).toBeCloseTo(0.5)
    expect(tempsDuClip(clip, 5, 0)).toBe(0)
  })
  it('orients the rig\'s axes toward the camera\'s', () => {
    for (const [origine, attendu] of [
      [[1, 0, 0], [0, 0, -1]], [[0, 0, 1], [1, 0, 0]], [[0, 1, 0], [0, 1, 0]],
    ]) {
      const resultat = new THREE.Vector3().fromArray(origine).applyQuaternion(ROTATION_RIG_CAMERA)
      expect(resultat.distanceTo(new THREE.Vector3().fromArray(attendu))).toBeLessThan(1e-10)
    }
  })
})
