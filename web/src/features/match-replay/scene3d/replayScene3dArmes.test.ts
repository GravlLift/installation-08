// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayScene3dArmes.test.ts — the scene's first-person arms: the pose NEVER falls back to the
 * static model while the rig is loaded (a paint or a dress-up in progress is applied as it
 * arrives, `rigVisible` tells the scene not to draw the model), and following a player prepares
 * their pieces and their paint once per follow.
 */
import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'

import { BrasPremierePersonne3d } from './brasPremierePersonne3d'

/** A minimal rig, ready to show (same inputs as the real pose). */
function weaponRig(arms: BrasPremierePersonne3d, file: string, key: string): THREE.Group {
  const material = new THREE.MeshStandardMaterial()
  material.userData.surfaceBrute = {}
  const root = new THREE.Group()
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), material))
  const clip = { name: 'idle', action: 'idle', variant: 0, type: 'base', overlay: false, frameCount: 60, frameRate: 30, durationSeconds: 2 }
  const rig = { file, bones: 1, triangles: 1, bytes: 1, clips: [clip], actions: [{ action: 'idle', variant: 0, clip: 'idle' }], missingActions: [] } as never
  const internal = arms as unknown as {
    entrees: Map<string, unknown>
    armes: Map<string, unknown>
    fichiersArmes: Map<string, string>
  }
  const idle = { time: 0, weight: 1 }
  internal.entrees.set(file, { root, materiaux: [material], mixer: { update: () => {} }, rig, actions: new Map([[clip.name, idle]]), listeActions: [idle], clip })
  internal.armes.set(key, rig)
  internal.fichiersArmes.set(file, key)
  return root
}

/** The empty frame: no life event (the poser only reads the arrays and the time). */
const emptyFrame = {
  rechargements: [], coups: [], tirs: [], grenades: [], changements: [], sprints: [],
  slides: [], accroupis: [], sauts: [], escalades: [], usages: [], frame: 0, fps: 30,
  rechargementValide: () => false,
} as never

/** The arms' pose at a frame, as the scene does it: hide, show, static model otherwise. */
function placeArms(arms: BrasPremierePersonne3d, camera: THREE.PerspectiveCamera, key: string | null, held: { model: unknown } | null) {
  arms.cacher()
  const rigVisible = arms.montrer(camera, key, emptyFrame, null, 0)
  const weaponModel = rigVisible ? null : held?.model ?? null
  return { rigVisible, weaponModel }
}

describe('replayScene3d: the first-person arms pose', () => {
  const warnings = () => vi.spyOn(console, 'warn').mockImplementation(() => {})

  it('does not fall back to the static model while the weapon\'s paint is in progress', () => {
    const t = warnings()
    const arms = new BrasPremierePersonne3d(new THREE.Scene(), '/premiere-personne')
    const root = weaponRig(arms, 'a.glb', 'arme')
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    const internal = arms as unknown as { peinture: { enCours: (f?: string) => boolean } }
    internal.peinture.enCours = () => true
    const { rigVisible, weaponModel } = placeArms(arms, camera, 'arme', { model: new THREE.Group() })
    expect(rigVisible).toBe(true)
    expect(weaponModel).toBeNull()
    expect(root.visible).toBe(true)
    arms.dispose()
    t.mockRestore()
  })

  it('keeps the arms visible on a switch to an unpainted weapon', () => {
    const t = warnings()
    const arms = new BrasPremierePersonne3d(new THREE.Scene(), '/premiere-personne')
    weaponRig(arms, 'a.glb', 'arme')
    const b = weaponRig(arms, 'b.glb', 'autre')
    const camera = new THREE.PerspectiveCamera(55, 16 / 9)
    expect(arms.montrer(camera, 'arme', emptyFrame, null, 0)).toBe(true)
    const { rigVisible, weaponModel } = placeArms(arms, camera, 'autre', { model: new THREE.Group() })
    expect(rigVisible).toBe(true)
    expect(weaponModel).toBeNull()
    expect(b.visible).toBe(true)
    arms.dispose()
    t.mockRestore()
  })

  it('prepares each of the player\'s loaded rigs\' pieces and paint once per follow', () => {
    const t = warnings()
    const arms = new BrasPremierePersonne3d(new THREE.Scene(), '/premiere-personne')
    weaponRig(arms, 'a.glb', 'arme')
    weaponRig(arms, 'b.glb', 'autre')
    const prepare = vi.spyOn(arms, 'preparerJoueur')
    expect(arms.cleRigDe('a.glb')).toBe('arme')
    expect(arms.cleRigDe('b.glb')).toBe('autre')
    arms.preparerJoueur('1')
    arms.preparerJoueur('1')
    expect(prepare).toHaveBeenCalledTimes(2)
    arms.dispose()
    t.mockRestore()
  })
})
