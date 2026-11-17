// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { fixtureClips } from '../test/spartanClips'
import { spartanSkeleton } from '../test/spartanSkeleton'
import { makeAvatar, placeBody, showWeapon, wearSpartan } from './avatar3d'
import { EYE_HEIGHT } from './body3d'
import { registerSpartanClips } from './clips3d'
import { newClipMix } from './clipSample3d'
import { MuzzleProbe, drawnMuzzle, muzzleOfModel, viewMuzzle } from './muzzle3d'
import { type Recoil } from './recoil3d'
import { recoilPoint } from './recoilPose3d'
import { aimDirThree } from './tracks3d'
import { viewGripOf } from './viewGrip3d'

const TEAM = new THREE.Color(1, 0.25, 0)
const FEET = new THREE.Vector3(2, 1, 3)
const KICK: Recoil = { back: 0.024, pitch: THREE.MathUtils.degToRad(6), yaw: 0.01, roll: -0.012 }
const REST: Recoil = { back: 0, pitch: 0, yaw: 0, roll: 0 }
const vec = (a: readonly number[]) => new THREE.Vector3(a[0], a[1], a[2])

function rifle(): THREE.Group {
  const g = new THREE.Group()
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.308, 0.1, 0.024).translate(0.144, 0.02, 0), new THREE.MeshBasicMaterial()))
  return g
}

function spartan() {
  const source = spartanSkeleton()
  const clips = fixtureClips(source)
  registerSpartanClips(source, clips)
  const mix = newClipMix()
  mix.baseCount = 1
  Object.assign(mix.base[0], { clip: clips.get('combat:rifle:idle'), time: 0, weight: 1, loop: true })
  return { source, mix }
}

/** Le repère monde du modèle d'arme dessiné. */
function weaponFrame(model: THREE.Object3D): THREE.Matrix4 {
  model.updateWorldMatrix(true, false)
  return model.matrixWorld.clone()
}

/** La position d'un os dans le repère du modèle d'arme. */
function inWeapon(root: THREE.Object3D, name: string, weapon: THREE.Matrix4): THREE.Vector3 {
  const b = root.getObjectByName(name) as THREE.Object3D
  return b.getWorldPosition(new THREE.Vector3()).applyMatrix4(weapon.clone().invert())
}

describe('le recul en 3e personne', () => {
  const { source, mix } = spartan()

  function pose(recoil: Recoil, gun = rifle()) {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    wearSpartan(a, source)
    placeBody(a, FEET, { h: 120, p: 15, crouch: false, dropOeil: 0, mix }, false)
    showWeapon(a, { color: TEAM, recoil }, gun, null)
    return { a, gun, root: a.spartan?.rig.root as THREE.Object3D, model: a.model as THREE.Object3D }
  }

  it('l’arme recule le long de son canon et lève la bouche, autour de la poignée', () => {
    const rest = pose(REST)
    const kicked = pose(KICK)
    const w0 = weaponFrame(rest.model)
    const w1 = weaponFrame(kicked.model)
    const barrel0 = new THREE.Vector3().setFromMatrixColumn(w0, 0).normalize()
    const grip0 = new THREE.Vector3().setFromMatrixPosition(w0)
    const grip1 = new THREE.Vector3().setFromMatrixPosition(w1)
    expect(grip1.clone().sub(grip0).dot(barrel0)).toBeCloseTo(-KICK.back, 6)
    const barrel1 = new THREE.Vector3().setFromMatrixColumn(w1, 0).normalize()
    expect(barrel1.y).toBeGreaterThan(barrel0.y)
    expect(barrel1.angleTo(barrel0)).toBeGreaterThan(0.9 * KICK.pitch)
  })

  it('les mains suivent l’arme : leur place dans le repère de l’arme ne change pas', () => {
    const rest = pose(REST)
    const kicked = pose(KICK)
    const w0 = weaponFrame(rest.model)
    const w1 = weaponFrame(kicked.model)
    for (const hand of ['b_l_hand', 'b_r_hand', 'b_l_forearm', 'b_r_forearm', 'b_l_grip']) {
      expect(inWeapon(kicked.root, hand, w1).distanceTo(inWeapon(rest.root, hand, w0))).toBeLessThan(1e-6)
    }
    // L'arme reste à sa tenue dans la main : c'est le bras qui bouge, pas l'arme dans la main.
    expect(kicked.model.position.length()).toBeLessThan(1e-12)
  })

  it('l’image suivante sans tir repart du repos : rien ne s’accumule', () => {
    const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
    wearSpartan(a, source)
    const gun = rifle()
    const frame = (recoil: Recoil) => {
      placeBody(a, FEET, { h: 40, p: -10, crouch: false, dropOeil: 0, mix }, false)
      showWeapon(a, { color: TEAM, recoil }, gun, null)
      return weaponFrame(a.model as THREE.Object3D)
    }
    const before = frame(REST)
    frame(KICK)
    frame(KICK)
    const after = frame(REST)
    expect(after.equals(before)).toBe(true)
  })

  it('la bouche du vol (MuzzleProbe) est la bouche dessinée, recul compris', () => {
    const { a, gun } = pose(KICK)
    const drawn = new THREE.Vector3()
    drawnMuzzle({ model: a.model as THREE.Object3D, source: gun }, drawn, new THREE.Vector3())
    const probe = new MuzzleProbe()
    const from = probe.at(source, gun, FEET, { h: 120, p: 15, mix, recoil: KICK }, new THREE.Vector3()) as THREE.Vector3
    expect(from.distanceTo(drawn)).toBeLessThan(1e-6)
    const still = probe.at(source, gun, FEET, { h: 120, p: 15, mix }, new THREE.Vector3()) as THREE.Vector3
    expect(still.distanceTo(from)).toBeGreaterThan(0.01)
  })
})

describe('le recul en 1re personne', () => {
  it('le modèle seul recule ; l’origine du vol suit la bouche dessinée', () => {
    for (const [h, p] of [[0, 0], [75, 30], [210, -45]]) {
      const a = makeAvatar(new THREE.Scene(), 'joueur', TEAM)
      const gun = rifle()
      const view = viewGripOf('1a22fee6')
      placeBody(a, FEET, { h, p, crouch: false, dropOeil: 0 }, true)
      const aimBefore = a.aim.quaternion.clone()
      showWeapon(a, { color: TEAM, recoil: KICK }, gun, view)
      // Le cône (et la caméra qui le suit) ne bouge pas : la visée du film porte déjà le regard.
      expect(a.aim.quaternion.equals(aimBefore)).toBe(true)
      const drawn = new THREE.Vector3()
      drawnMuzzle({ model: a.model as THREE.Object3D, source: gun }, drawn, new THREE.Vector3())
      const eye = FEET.clone().setY(FEET.y + EYE_HEIGHT)
      const local = recoilPoint(muzzleOfModel(gun), KICK, new THREE.Vector3())
      const pure = viewMuzzle(eye, vec(aimDirThree(h, p)), view, local, new THREE.Vector3())
      expect(pure.distanceTo(drawn)).toBeLessThan(1e-6)
      const still = viewMuzzle(eye, vec(aimDirThree(h, p)), view, muzzleOfModel(gun), new THREE.Vector3())
      expect(still.distanceTo(drawn)).toBeGreaterThan(0.01)
    }
  })
})
