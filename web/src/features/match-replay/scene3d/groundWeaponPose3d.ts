import * as THREE from 'three'

/** La poignée est relevée jusqu'à ce que le modèle couché touche le sol. */
export function groundWeaponPose(model: THREE.Object3D, yaw: number): { rotation: THREE.Quaternion; lift: number } {
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2))
  const copy = model.clone()
  copy.position.set(0, 0, 0)
  copy.quaternion.copy(rotation)
  copy.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(copy, true)
  return { rotation, lift: bounds.isEmpty() ? 0 : -bounds.min.y }
}
