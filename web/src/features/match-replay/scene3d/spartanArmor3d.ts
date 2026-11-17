// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * spartanArmor3d.ts — A PLAYER'S ARMOR POSED ON THEIR SPARTAN COPY: the copy's default armor
 * (`spartan3d.copySpartan`) gives way to its outfit's pieces (`armory3d.Outfit`).
 *
 * ONE skeleton: each skinned piece is a new `SkinnedMesh` on the library's geometry and
 * material, bound to the copy's skeleton (the one the clips and pitch pose) with its piece's
 * bind matrix. Pieces carry the same bones, in the same order, with the same inverse bind
 * matrices as the `spartan` model (the contract from `meshproto/pieces_index.go`): the skeleton
 * is recomputed once per frame for the whole armor. Accessories are rigid, children of their
 * bone at their marker instance's pose, then at their offset.
 *
 * Nothing is owned here: source geometries and materials belong to the library, the tinted
 * materials and the skeleton belong to the copy (`releaseSpartan`).
 */
import * as THREE from 'three'

import type { ArmorPose } from './armorPlan3d'
import type { Outfit } from './armory3d'

/**
 * dressSpartan dresses copy `root` (skeleton `skeleton`) in outfit `outfit`. False, and the copy
 * unchanged, when the skeleton's bones aren't the outfit's.
 */
export function dressSpartan(root: THREE.Object3D, skeleton: THREE.Skeleton, outfit: Outfit): boolean {
  if (!sameBones(skeleton, outfit.bones)) {
    console.warn('3D replay: the Spartan\'s skeleton is not the armor pieces\' own, defaulting to the default armor')
    return false
  }
  const defaults: THREE.Object3D[] = []
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) defaults.push(o)
  })
  for (const o of defaults) o.removeFromParent()
  for (const src of outfit.skinned) {
    const mesh = new THREE.SkinnedMesh(src.geometry, src.material)
    mesh.name = src.name
    mesh.castShadow = src.castShadow
    mesh.receiveShadow = src.receiveShadow
    root.add(mesh)
    mesh.bind(skeleton, src.bindMatrix)
  }
  const bones = new Map(skeleton.bones.map((b) => [b.name, b]))
  for (const r of outfit.rigid) {
    const anchor = posed(new THREE.Group(), r.instance)
    ;(bones.get(r.bone) ?? root).add(anchor)
    const offset = posed(new THREE.Group(), r.offset)
    anchor.add(offset)
    for (const { mesh: src, matrix } of r.meshes) {
      const mesh = new THREE.Mesh(src.geometry, src.material)
      mesh.name = src.name
      matrix.decompose(mesh.position, mesh.quaternion, mesh.scale)
      mesh.castShadow = src.castShadow
      mesh.receiveShadow = src.receiveShadow
      offset.add(mesh)
    }
  }
  return true
}

function posed<T extends THREE.Object3D>(o: T, pose: ArmorPose): T {
  o.position.fromArray(pose.translation)
  o.quaternion.fromArray(pose.rotation)
  return o
}

function sameBones(skeleton: THREE.Skeleton, names: readonly string[]): boolean {
  return skeleton.bones.length === names.length && skeleton.bones.every((b, i) => b.name === names[i])
}
