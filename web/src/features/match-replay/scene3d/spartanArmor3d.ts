/**
 * spartanArmor3d.ts — L'ARMURE D'UN JOUEUR POSÉE SUR SA COPIE DU SPARTAN : l'armure par défaut de la
 * copie (`spartan3d.copySpartan`) cède la place aux pièces de sa tenue (`armory3d.Outfit`).
 *
 * UN squelette : chaque pièce à peau est un nouveau `SkinnedMesh` sur la géométrie et le matériau
 * de la bibliothèque, lié au squelette de la copie (celui que les clips et le tangage posent) avec
 * la matrice de liaison de sa pièce. Les pièces portent les mêmes os, dans le même ordre, avec les
 * mêmes matrices inverses de liaison que le modèle `spartan` (contrat de `meshproto/pieces_index.go`) :
 * le squelette se recalcule une fois par image pour toute l'armure. Les accessoires sont rigides,
 * enfants de leur os à la pose de leur instance de marqueur, puis à leur décalage.
 *
 * Rien n'est possédé ici : géométries et matériaux source sont à la bibliothèque, les matériaux
 * teints et le squelette à la copie (`releaseSpartan`).
 */
import * as THREE from 'three'

import type { ArmorPose } from './armorPlan3d'
import type { Outfit } from './armory3d'

/**
 * dressSpartan habille la copie `root` (squelette `skeleton`) de la tenue `outfit`. Faux, et la
 * copie inchangée, quand les os du squelette ne sont pas ceux de la tenue.
 */
export function dressSpartan(root: THREE.Object3D, skeleton: THREE.Skeleton, outfit: Outfit): boolean {
  if (!sameBones(skeleton, outfit.bones)) {
    console.warn('rejeu 3D : le squelette du Spartan n’est pas celui des pièces d’armure, armure par défaut')
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
