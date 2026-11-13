import * as THREE from 'three'
import { describe, expect, it } from 'vitest'

import { groundWeaponPose } from './groundWeaponPose3d'

describe('groundWeaponPose', () => {
  it('pose un modèle décentré sur le sol et conserve un cap horizontal stable', () => {
    const model = new THREE.Group()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 0.2))
    mesh.position.set(0.3, 0.5, 0.25)
    model.add(mesh)
    const pose = groundWeaponPose(model, 1.2)
    const copy = model.clone()
    copy.quaternion.copy(pose.rotation)
    copy.position.set(4, 7 + pose.lift, 8)
    copy.updateMatrixWorld(true)
    expect(new THREE.Box3().setFromObject(copy).min.y).toBeCloseTo(7)
    expect(new THREE.Vector3(1, 0, 0).applyQuaternion(pose.rotation).y).toBeCloseTo(0)
    expect(groundWeaponPose(model, 1.2).rotation.equals(pose.rotation)).toBe(true)
  })

  it('ne produit pas de hauteur infinie pour un modèle vide', () => {
    expect(groundWeaponPose(new THREE.Group(), 0).lift).toBe(0)
  })
})
