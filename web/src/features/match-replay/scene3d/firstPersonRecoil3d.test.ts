// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'

import { newRecoil } from './recoil3d'
import { ROTATION_RIG_CAMERA } from './firstPersonRig3d'
import { FP_RECOIL_GAIN, recoilPivot, applyRigRecoil } from './firstPersonRecoil3d'

const PIVOT = new THREE.Vector3(0.05, -0.04, 0.02)
const MUZZLE = new THREE.Vector3(0.25, -0.03, 0.02)

/** A rig under a support rotated the way `FirstPersonArms3d.place` rotates it (camera at the origin). */
function rigUnderCamera(): { support: THREE.Group; root: THREE.Group } {
  const support = new THREE.Group()
  support.quaternion.copy(ROTATION_RIG_CAMERA)
  const root = new THREE.Group()
  support.add(root)
  return { support, root }
}

/** Rig point `p` in camera frame (x right, y up, -z forward). */
function inCamera(support: THREE.Object3D, p: THREE.Vector3): THREE.Vector3 {
  support.updateMatrixWorld(true)
  return p.clone().applyMatrix4(support.children[0].matrixWorld)
}

describe('applyRigRecoil', () => {
  it('leaves the rig at rest with no recoil or a zero recoil', () => {
    const root = new THREE.Group()
    applyRigRecoil(root, null, PIVOT)
    expect(root.position.length()).toBe(0)
    expect(root.quaternion.equals(new THREE.Quaternion())).toBe(true)
    applyRigRecoil(root, newRecoil(), PIVOT)
    expect(root.position.length()).toBe(0)
    expect(root.quaternion.equals(new THREE.Quaternion())).toBe(true)
  })

  it('pulls the rig back along the aim\'s forward, toward the eye', () => {
    const { support, root } = rigUnderCamera()
    const before = inCamera(support, MUZZLE)
    applyRigRecoil(root, { ...newRecoil(), back: 0.012 }, PIVOT)
    const after = inCamera(support, MUZZLE)
    // The camera's forward is -Z: pulling back means z increases, with no lateral or vertical offset.
    expect(after.z - before.z).toBeCloseTo(0.012 * FP_RECOIL_GAIN, 9)
    expect(after.x).toBeCloseTo(before.x, 9)
    expect(after.y).toBeCloseTo(before.y, 9)
  })

  it('raises the muzzle around the pivot, which stays in place', () => {
    const { support, root } = rigUnderCamera()
    const muzzleBefore = inCamera(support, MUZZLE)
    const pivotBefore = inCamera(support, PIVOT)
    applyRigRecoil(root, { ...newRecoil(), pitch: (3 * Math.PI) / 180 }, PIVOT)
    const muzzleAfter = inCamera(support, MUZZLE)
    const pivotAfter = inCamera(support, PIVOT)
    expect(muzzleAfter.y).toBeGreaterThan(muzzleBefore.y)
    expect(muzzleAfter.x).toBeCloseTo(muzzleBefore.x, 9)
    expect(pivotAfter.distanceTo(pivotBefore)).toBeLessThan(1e-9)
    // The barrel rotates by the pitch multiplied by the gain.
    const barrelBefore = muzzleBefore.clone().sub(pivotBefore).normalize()
    const barrelAfter = muzzleAfter.clone().sub(pivotAfter).normalize()
    expect(barrelBefore.angleTo(barrelAfter)).toBeCloseTo((3 * Math.PI) / 180 * FP_RECOIL_GAIN, 6)
  })

  it('accumulates nothing: posing twice equals posing once, and rest comes back', () => {
    const recoil = { back: 0.01, pitch: 0.05, yaw: 0.004, roll: -0.006 }
    const root = new THREE.Group()
    applyRigRecoil(root, recoil, PIVOT)
    const position = root.position.clone()
    const quaternion = root.quaternion.clone()
    applyRigRecoil(root, recoil, PIVOT)
    expect(root.position.distanceTo(position)).toBeLessThan(1e-12)
    expect(root.quaternion.angleTo(quaternion)).toBeLessThan(1e-9)
    applyRigRecoil(root, null, PIVOT)
    expect(root.position.length()).toBe(0)
    expect(root.quaternion.equals(new THREE.Quaternion())).toBe(true)
  })
})

describe('recoilPivot', () => {
  it('takes the weapon\'s root at idle, null with no weapon pose', () => {
    expect(recoilPivot({ position: [1, 2, 3] })?.toArray()).toEqual([1, 2, 3])
    expect(recoilPivot(undefined)).toBeNull()
  })
})
