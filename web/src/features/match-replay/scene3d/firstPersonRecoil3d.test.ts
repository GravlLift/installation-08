// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { newRecoil } from './recoil3d'
import { ROTATION_RIG_CAMERA } from './premierePersonne3d'
import { FP_RECOIL_GAIN, pivotDuRecul, poserReculRig } from './firstPersonRecoil3d'

const PIVOT = new THREE.Vector3(0.05, -0.04, 0.02)
const BOUCHE = new THREE.Vector3(0.25, -0.03, 0.02)

/** A rig under a support rotated the way `FirstPersonArms3d.placer` rotates it (camera at the origin). */
function rigSousCamera(): { support: THREE.Group; racine: THREE.Group } {
  const support = new THREE.Group()
  support.quaternion.copy(ROTATION_RIG_CAMERA)
  const racine = new THREE.Group()
  support.add(racine)
  return { support, racine }
}

/** Rig point `p` in camera frame (x right, y up, -z forward). */
function enCamera(support: THREE.Object3D, p: THREE.Vector3): THREE.Vector3 {
  support.updateMatrixWorld(true)
  return p.clone().applyMatrix4(support.children[0].matrixWorld)
}

describe('poserReculRig', () => {
  it('leaves the rig at rest with no recoil or a zero recoil', () => {
    const racine = new THREE.Group()
    poserReculRig(racine, null, PIVOT)
    expect(racine.position.length()).toBe(0)
    expect(racine.quaternion.equals(new THREE.Quaternion())).toBe(true)
    poserReculRig(racine, newRecoil(), PIVOT)
    expect(racine.position.length()).toBe(0)
    expect(racine.quaternion.equals(new THREE.Quaternion())).toBe(true)
  })

  it('pulls the rig back along the aim\'s forward, toward the eye', () => {
    const { support, racine } = rigSousCamera()
    const avant = enCamera(support, BOUCHE)
    poserReculRig(racine, { ...newRecoil(), back: 0.012 }, PIVOT)
    const apres = enCamera(support, BOUCHE)
    // The camera's forward is -Z: pulling back means z increases, with no lateral or vertical offset.
    expect(apres.z - avant.z).toBeCloseTo(0.012 * FP_RECOIL_GAIN, 9)
    expect(apres.x).toBeCloseTo(avant.x, 9)
    expect(apres.y).toBeCloseTo(avant.y, 9)
  })

  it('raises the muzzle around the pivot, which stays in place', () => {
    const { support, racine } = rigSousCamera()
    const boucheAvant = enCamera(support, BOUCHE)
    const pivotAvant = enCamera(support, PIVOT)
    poserReculRig(racine, { ...newRecoil(), pitch: (3 * Math.PI) / 180 }, PIVOT)
    const boucheApres = enCamera(support, BOUCHE)
    const pivotApres = enCamera(support, PIVOT)
    expect(boucheApres.y).toBeGreaterThan(boucheAvant.y)
    expect(boucheApres.x).toBeCloseTo(boucheAvant.x, 9)
    expect(pivotApres.distanceTo(pivotAvant)).toBeLessThan(1e-9)
    // The barrel rotates by the pitch multiplied by the gain.
    const canonAvant = boucheAvant.clone().sub(pivotAvant).normalize()
    const canonApres = boucheApres.clone().sub(pivotApres).normalize()
    expect(canonAvant.angleTo(canonApres)).toBeCloseTo((3 * Math.PI) / 180 * FP_RECOIL_GAIN, 6)
  })

  it('accumulates nothing: posing twice equals posing once, and rest comes back', () => {
    const recul = { back: 0.01, pitch: 0.05, yaw: 0.004, roll: -0.006 }
    const racine = new THREE.Group()
    poserReculRig(racine, recul, PIVOT)
    const position = racine.position.clone()
    const quaternion = racine.quaternion.clone()
    poserReculRig(racine, recul, PIVOT)
    expect(racine.position.distanceTo(position)).toBeLessThan(1e-12)
    expect(racine.quaternion.angleTo(quaternion)).toBeLessThan(1e-9)
    poserReculRig(racine, null, PIVOT)
    expect(racine.position.length()).toBe(0)
    expect(racine.quaternion.equals(new THREE.Quaternion())).toBe(true)
  })
})

describe('pivotDuRecul', () => {
  it('takes the weapon\'s root at idle, null with no weapon pose', () => {
    expect(pivotDuRecul({ position: [1, 2, 3] })?.toArray()).toEqual([1, 2, 3])
    expect(pivotDuRecul(undefined)).toBeNull()
  })
})
