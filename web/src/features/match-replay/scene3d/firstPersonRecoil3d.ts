// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * firstPersonRecoil3d.ts — THE FIRST-PERSON RIG'S RECOIL (arms and weapon animated together).
 *
 * The frame's offset (`recoil3d`) is applied to the rig's root (the glTF scene, a child of
 * `FirstPersonArms3d`'s support), after the clips, as a single rigid motion: the hands stay
 * on the weapon. This root's frame is the rig's own, which the support rotates by
 * `ROTATION_RIG_CAMERA` under the camera: +X the aim's forward (the barrel at rest), +Y up, +Z
 * right. This is `recoil3d`'s own weapon-model frame: the offset's rotation (`recoilRotation`)
 * reads there as is, pitch raises the muzzle around the view's right, recoil pulls backward (-X).
 *
 * The pivot sits near the grip (the weapon's root at idle), not the eye: pivoting around the eye
 * would sweep the weapon across the screen. The root is recomposed from rest (the glTF scene's
 * identity) every frame: nothing accumulates, the same frame gives the same pose.
 */
import * as THREE from 'three'

import { newRecoil, recoilActive, type Recoil } from './recoil3d'
import { recoilRotation } from './recoilPose3d'

/** The first-person recoil gain, on `back` and `pitch`: the camera sits right up against the weapon there. */
export const FP_RECOIL_GAIN = 1.5

// Shared scratch values: the pose is rebuilt every rendered frame, with no allocation.
const SCRATCH_RECOIL = newRecoil()
const SCRATCH_ROTATION = new THREE.Quaternion()
const SCRATCH_PIVOT = new THREE.Vector3()

/**
 * recoilPivot: the recoil's pivot in the rig's frame, the weapon's root at idle
 * (`idleWeapon.position`); null with no weapon pose in the index.
 */
export function recoilPivot(idleWeapon: { position: readonly [number, number, number] } | undefined): THREE.Vector3 | null {
  return idleWeapon ? new THREE.Vector3(idleWeapon.position[0], idleWeapon.position[1], idleWeapon.position[2]) : null
}

/**
 * applyRigRecoil recomposes rig root `root` from rest: offset `recoil` (null or zero: rest),
 * `back` and `pitch` multiplied by `FP_RECOIL_GAIN`, rotated around `pivot` (rig frame) then
 * pulled back along forward: x' = R (x - p) + p - back X.
 */
export function applyRigRecoil(root: THREE.Object3D, recoil: Recoil | null, pivot: THREE.Vector3): void {
  root.position.set(0, 0, 0)
  root.quaternion.identity()
  if (!recoilActive(recoil)) return
  SCRATCH_RECOIL.back = recoil.back * FP_RECOIL_GAIN
  SCRATCH_RECOIL.pitch = recoil.pitch * FP_RECOIL_GAIN
  SCRATCH_RECOIL.yaw = recoil.yaw
  SCRATCH_RECOIL.roll = recoil.roll
  const rotation = recoilRotation(SCRATCH_RECOIL, SCRATCH_ROTATION)
  root.quaternion.copy(rotation)
  root.position.copy(pivot).sub(SCRATCH_PIVOT.copy(pivot).applyQuaternion(rotation))
  root.position.x -= SCRATCH_RECOIL.back
}
