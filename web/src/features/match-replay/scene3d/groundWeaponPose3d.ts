// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import * as THREE from 'three'

/** La poignée est relevée jusqu'à ce que le modèle couché touche le sol. */
export function groundWeaponPose(model: THREE.Object3D, yaw: number): { rotation: THREE.Quaternion; lift: number } {
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))
  return { rotation, lift: liftToFloor(model, rotation) }
}

/**
 * standingWeaponPose — un modèle debout dans ses propres axes (haut du modèle vers le haut du
 * monde), relevé jusqu'à ce que son point le plus bas touche le sol : le drapeau planté sur sa
 * base ou là où il est tombé.
 */
export function standingWeaponPose(model: THREE.Object3D): { rotation: THREE.Quaternion; lift: number } {
  const rotation = new THREE.Quaternion()
  return { rotation, lift: liftToFloor(model, rotation) }
}

/**
 * standingItemCorrection — the pose correction of an equipment item, whose GLB is not authored
 * with the weapon's up (a Repulsor disc arrives lying flat, its thin axis up): the item is turned
 * so its thinnest bounding-box axis is HORIZONTAL (a disc stands on its edge, facing the viewer)
 * and the tallest of the two remaining axes is world up, whatever its native axes. The item's
 * center in its own space is returned so the caller can center it on its float height. Identity
 * (and a zero center) when the box is empty. The correction is applied BEFORE the spin about
 * world up, which then turns the item in place.
 */
export function standingItemCorrection(model: THREE.Object3D): { rotation: THREE.Quaternion; center: THREE.Vector3 } {
  const copy = model.clone()
  copy.position.set(0, 0, 0)
  copy.quaternion.identity()
  copy.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(copy, true)
  if (bounds.isEmpty()) return { rotation: new THREE.Quaternion(), center: new THREE.Vector3() }
  const s = [bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z]
  const a = s[0] <= s[1] && s[0] <= s[2] ? 0 : s[1] <= s[2] ? 1 : 2
  const rest = [0, 1, 2].filter((k) => k !== a)
  const b = s[rest[0]] >= s[rest[1]] ? rest[0] : rest[1]
  const c = rest[0] + rest[1] - b
  // The frame must stay right-handed: the thin axis goes along +X, the tall one along +Y; when
  // a, b, c are a left-handed triple the thin axis takes -X instead (the rotation stays proper).
  const even = (a - b) * (b - c) * (c - a) > 0
  // Columns of the rotation: the image of each local axis (thin -> X, up -> +Y, the rest -> +Z).
  const col = (k: number) =>
    k === a ? new THREE.Vector3(even ? 1 : -1, 0, 0) : k === b ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
  return {
    rotation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(col(0), col(1), col(2))),
    center: bounds.getCenter(new THREE.Vector3()),
  }
}

/**
 * faceMountOffset — where a model's origin goes so that, turned by `rotation`, the model is centered
 * on its mount point in its own X and Y and its back (the min of its own Z) sits `face` in front of
 * it along its own +Z: a weapon hung on the front of a rack, whatever its grip origin.
 */
export function faceMountOffset(model: THREE.Object3D, rotation: THREE.Quaternion, face: number): THREE.Vector3 {
  const copy = model.clone()
  copy.position.set(0, 0, 0)
  copy.quaternion.identity()
  copy.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(copy, true)
  if (bounds.isEmpty()) return new THREE.Vector3(0, 0, face).applyQuaternion(rotation)
  const center = bounds.getCenter(new THREE.Vector3())
  return new THREE.Vector3(-center.x, -center.y, face - bounds.min.z).applyQuaternion(rotation)
}

/**
 * centerOffset — where a model's origin goes, in the model's own frame, so that the center of its
 * bounds sits on the mount point: an equipment pickup floating above its pad, whose model's origin
 * is not on the item (the Drop Wall pickup's mesh sits about 0.4 u above its origin).
 */
export function centerOffset(model: THREE.Object3D): THREE.Vector3 {
  const copy = model.clone()
  copy.position.set(0, 0, 0)
  copy.quaternion.identity()
  copy.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(copy, true)
  return bounds.isEmpty() ? new THREE.Vector3() : bounds.getCenter(new THREE.Vector3()).negate()
}

/** liftToFloor : de combien l'origine du modèle tourné de `rotation` se lève pour que son dessous soit au sol. */
function liftToFloor(model: THREE.Object3D, rotation: THREE.Quaternion): number {
  const copy = model.clone()
  copy.position.set(0, 0, 0)
  copy.quaternion.copy(rotation)
  copy.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(copy, true)
  return bounds.isEmpty() ? 0 : -bounds.min.y
}
