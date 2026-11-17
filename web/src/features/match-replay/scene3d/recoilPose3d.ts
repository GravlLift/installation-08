// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * recoilPose3d.ts — RECOIL APPLIED TO THE DRAWN WEAPON (the deviation from `recoil3d`, the
 * weapon model's frame: X barrel, Y up, origin at the grip, the recoil's pivot).
 *
 * In first person (and without a Spartan), the deviation goes to the model alone (`recoilModel`):
 * the camera does not move, the film's recorded aim already carries the look's real motion. In
 * third person, it goes to both clavicles (`recoilArms`): both arms and the weapon the right hand
 * carries move with one rigid motion, after the clips; the hands stay on the weapon. A shot's
 * muzzle is read on the same pose (`recoilPoint` for a model carried alone).
 */
import * as THREE from 'three'

import type { Recoil } from './recoil3d'

const euler = new THREE.Euler()
const turn = new THREE.Quaternion()
const shift = new THREE.Vector3()
const ONE = new THREE.Vector3(1, 1, 1)
const weaponW = new THREE.Matrix4()
const delta = new THREE.Matrix4()
const inv = new THREE.Matrix4()
const local = new THREE.Matrix4()
const m = new THREE.Matrix4()

/** recoilRotation: the deviation's rotation (lifts the muzzle, then yaw and roll), model frame. */
export function recoilRotation(r: Recoil, out: THREE.Quaternion): THREE.Quaternion {
  // Order 'ZYX': Rz(pitch) · Ry(yaw) · Rx(roll); turning about +Z carries the barrel (X) toward up (Y).
  return out.setFromEuler(euler.set(r.roll, r.yaw, r.pitch, 'ZYX'))
}

/** recoilPoint: model point `p` (its own frame) moved by the deviation, in the resting model's frame. */
export function recoilPoint(p: THREE.Vector3, r: Recoil, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(p).applyQuaternion(recoilRotation(r, turn)).add(shift.set(-r.back, 0, 0))
}

/** recoilModel adds the deviation to the carry `model` already has in its holder (position and orientation). */
export function recoilModel(model: THREE.Object3D, r: Recoil): void {
  model.position.add(shift.set(-r.back, 0, 0).applyQuaternion(model.quaternion))
  model.quaternion.multiply(recoilRotation(r, turn))
}

/**
 * recoilArms applies the deviation to arms `arms` (the clavicles) of a Spartan whose `grip` bone
 * carries the weapon at orientation `gripToWeapon`: the world motion T = W · R · W⁻¹ (W the
 * weapon, R the deviation) is applied to each clavicle in its parent's frame. False without
 * clavicles: nothing is applied.
 */
export function recoilArms(arms: readonly THREE.Bone[], grip: THREE.Object3D, gripToWeapon: THREE.Quaternion, r: Recoil): boolean {
  if (arms.length === 0) return false
  grip.updateWorldMatrix(true, false)
  weaponW.multiplyMatrices(grip.matrixWorld, m.makeRotationFromQuaternion(gripToWeapon))
  local.compose(shift.set(-r.back, 0, 0), recoilRotation(r, turn), ONE)
  delta.multiplyMatrices(weaponW, local).multiply(inv.copy(weaponW).invert())
  for (const bone of arms) {
    const parent = bone.parent
    if (!parent) continue
    parent.updateWorldMatrix(true, false)
    // local' = P⁻¹ · T · P · local
    local.compose(bone.position, bone.quaternion, bone.scale)
    m.multiplyMatrices(inv.copy(parent.matrixWorld).invert(), delta).multiply(parent.matrixWorld).multiply(local)
    m.decompose(bone.position, bone.quaternion, bone.scale)
    bone.updateMatrixWorld(true)
  }
  return true
}
