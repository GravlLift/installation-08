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
