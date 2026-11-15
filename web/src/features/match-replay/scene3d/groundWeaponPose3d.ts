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
 * centeredOffset — the offset that puts the middle of the model's bounds, turned by `rotation`, on
 * its mount point: a rack holds the weapon inside its frame, whatever the weapon's grip origin.
 */
export function centeredOffset(model: THREE.Object3D, rotation: THREE.Quaternion): THREE.Vector3 {
  const copy = model.clone()
  copy.position.set(0, 0, 0)
  copy.quaternion.copy(rotation)
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
