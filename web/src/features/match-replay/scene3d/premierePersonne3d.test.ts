// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { clipDuRig, rigDeLArme, ROTATION_RIG_CAMERA, tempsDuClip, type IndexPremierePersonne } from './premierePersonne3d'

const clip = { name: 'attente', action: 'idle', variant: 0, type: 'base', overlay: false, frameCount: 30, frameRate: 30, durationSeconds: 1 }
const rig = { file: 'rig.glb', bones: 1, triangles: 1, bytes: 1, clips: [clip], actions: [{ action: 'idle', variant: 0, clip: 'attente' }], missingActions: [] }
const index: IndexPremierePersonne = { schema: 1, weapons: [{ weapon: 'abcdef12', file: rig.file }], rigs: [rig], failures: [], textures: {} }

describe('première personne', () => {
  it('trouve le rig par clé sans distinguer la casse', () => {
    expect(rigDeLArme(index, 'ABCDEF12')).toBe(rig)
    expect(rigDeLArme(index, '12345678')).toBeNull()
    expect(rigDeLArme(index, null)).toBeNull()
  })
  it('trouve le clip par les actions et sa variante', () => {
    expect(clipDuRig(rig, 'idle')).toBe(clip)
    expect(clipDuRig(rig, 'idle', 1)).toBeNull()
    expect(clipDuRig(rig, 'fire')).toBeNull()
  })
  it('calcule un temps déterministe et bouclé', () => {
    expect(tempsDuClip(clip, 15, 10)).toBeCloseTo(0.5)
    expect(tempsDuClip(clip, 5, 10)).toBeCloseTo(0.5)
    expect(tempsDuClip(clip, -5, 10)).toBeCloseTo(0.5)
    expect(tempsDuClip(clip, 5, 0)).toBe(0)
  })
  it('oriente les axes du rig vers ceux de la caméra', () => {
    for (const [origine, attendu] of [
      [[1, 0, 0], [0, 0, -1]], [[0, 0, 1], [1, 0, 0]], [[0, 1, 0], [0, 1, 0]],
    ]) {
      const resultat = new THREE.Vector3().fromArray(origine).applyQuaternion(ROTATION_RIG_CAMERA)
      expect(resultat.distanceTo(new THREE.Vector3().fromArray(attendu))).toBeLessThan(1e-10)
    }
  })
})
