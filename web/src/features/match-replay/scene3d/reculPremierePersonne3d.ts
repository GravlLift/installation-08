// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * reculPremierePersonne3d.ts — THE FIRST-PERSON RIG'S RECOIL (arms and weapon animated together).
 *
 * The frame's offset (`recoil3d`) is applied to the rig's root (the glTF scene, a child of
 * `BrasPremierePersonne3d`'s support), after the clips, as a single rigid motion: the hands stay
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
const BAC_RECUL = newRecoil()
const BAC_TOUR = new THREE.Quaternion()
const BAC_PIVOT = new THREE.Vector3()

/**
 * pivotDuRecul: the recoil's pivot in the rig's frame, the weapon's root at idle
 * (`idleWeapon.position`); null with no weapon pose in the index.
 */
export function pivotDuRecul(idleWeapon: { position: readonly [number, number, number] } | undefined): THREE.Vector3 | null {
  return idleWeapon ? new THREE.Vector3(idleWeapon.position[0], idleWeapon.position[1], idleWeapon.position[2]) : null
}

/**
 * poserReculRig recomposes rig root `racine` from rest: offset `recul` (null or zero: rest),
 * `back` and `pitch` multiplied by `FP_RECOIL_GAIN`, rotated around `pivot` (rig frame) then
 * pulled back along forward: x' = R (x - p) + p - back X.
 */
export function poserReculRig(racine: THREE.Object3D, recul: Recoil | null, pivot: THREE.Vector3): void {
  racine.position.set(0, 0, 0)
  racine.quaternion.identity()
  if (!recoilActive(recul)) return
  BAC_RECUL.back = recul.back * FP_RECOIL_GAIN
  BAC_RECUL.pitch = recul.pitch * FP_RECOIL_GAIN
  BAC_RECUL.yaw = recul.yaw
  BAC_RECUL.roll = recul.roll
  const tour = recoilRotation(BAC_RECUL, BAC_TOUR)
  racine.quaternion.copy(tour)
  racine.position.copy(pivot).sub(BAC_PIVOT.copy(pivot).applyQuaternion(tour))
  racine.position.x -= BAC_RECUL.back
}
