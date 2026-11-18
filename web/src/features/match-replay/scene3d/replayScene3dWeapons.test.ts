// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayScene3dWeapons.test.ts — the scene's first-person arms: the pose NEVER falls back to the
 * static model while the rig is loaded (a paint or a dress-up in progress is applied as it
 * arrives, `rigVisible` tells the scene not to draw the model), and following a player prepares
 * their pieces and their paint once per follow.
 */
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { FirstPersonArms3d } from './firstPersonArms3d'

/** A minimal rig, ready to show (same inputs as the real pose). */
function weaponRig(arms: FirstPersonArms3d, file: string, key: string): THREE.Group {
  const material = new THREE.MeshStandardMaterial()
  material.userData.surfaceBrute = {}
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
  const clip = { name: 'idle', action: 'idle', variant: 0, type: 'base', overlay: false, frameCount: 60, frameRate: 30, durationSeconds: 2 }
  const rig = { file, bones: 1, triangles: 1, bytes: 1, clips: [clip], actions: [{ action: 'idle', variant: 0, clip: 'idle' }], missingActions: [] } as never
  const internal = arms as unknown as {
    entries: Map<string, unknown>
    weapons: Map<string, unknown>
    weaponFiles: Map<string, string>
  }
  const idle = { time: 0, weight: 1 }
  internal.entries.set(file, { root, materials: [material], mixer: { update: () => {} }, rig, actions: new Map([[clip.name, idle]]), actionList: [idle], clip })
  internal.weapons.set(key, rig)
  internal.weaponFiles.set(file, key)
  return root
}

/** The empty frame: no life event (the poser only reads the arrays and the time). */
const emptyFrame = {
  reloads: [], strikes: [], shots: [], grenades: [], weaponSwitches: [], sprints: [],
  slides: [], crouches: [], jumps: [], climbs: [], usages: [], frame: 0, fps: 30,
  reloadValid: () => false,
} as never

/** The arms' pose at a frame, as the scene does it: hide, show, static model otherwise. */
function placeArms(arms: FirstPersonArms3d, camera: THREE.PerspectiveCamera, key: string | null, held: { model: unknown } | null) {
  arms.hide()
  const rigVisible = arms.show(camera, key, emptyFrame, null, 0)
  const weaponModel = rigVisible ? null : held?.model ?? null
  return { rigVisible, weaponModel }
}

describe('replayScene3d: the first-person arms pose', () => {
  const warnings = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('does not fall back to the static model while the weapon\'s paint is in progress', () => {
    const t = warnings()
    const arms = new FirstPersonArms3d(new THREE.Scene(), '/first-person')
    const root = weaponRig(arms, 'a.glb', 'weapon')
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const internal = arms as unknown as { paint: { busy: (f?: string) => boolean } }
    internal.paint.busy = () => true
    const { rigVisible, weaponModel } = placeArms(arms, camera, 'weapon', { model: new THREE.Group() })
    expect(rigVisible).toBe(true)
    expect(weaponModel).toBeNull()
    expect(root.visible).toBe(true)
    arms.dispose()
    t.mockRestore()
  })

  it('keeps the arms visible on a switch to an unpainted weapon', () => {
    const t = warnings()
    const arms = new FirstPersonArms3d(new THREE.Scene(), '/first-person')
    weaponRig(arms, 'a.glb', 'weapon')
    const b = weaponRig(arms, 'b.glb', 'other')
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    expect(arms.show(camera, 'weapon', emptyFrame, null, 0)).toBe(true)
    const { rigVisible, weaponModel } = placeArms(arms, camera, 'other', { model: new THREE.Group() })
    expect(rigVisible).toBe(true)
    expect(weaponModel).toBeNull()
    expect(b.visible).toBe(true)
    arms.dispose()
    t.mockRestore()
  })

  it('prepares each of the player\'s loaded rigs\' pieces and paint once per follow', () => {
    const t = warnings()
    const arms = new FirstPersonArms3d(new THREE.Scene(), '/first-person')
    weaponRig(arms, 'a.glb', 'weapon')
    weaponRig(arms, 'b.glb', 'other')
    const prepare = vi.spyOn(arms, 'preparePlayer')
    expect(arms.weaponKeyForRig('a.glb')).toBe('weapon')
    expect(arms.weaponKeyForRig('b.glb')).toBe('other')
    arms.preparePlayer('1')
    arms.preparePlayer('1')
    expect(prepare).toHaveBeenCalledTimes(2)
    arms.dispose()
    t.mockRestore()
  })
})
