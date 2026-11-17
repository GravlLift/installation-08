// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * pose3d.ts — LA POSE DU SPARTAN DU JEU dans la scène 3D : ses os trouvés par leur nom (ceux du
 * jeu, `b_pelvis`, `b_spine2`, ...), puis à chaque image le cap sur la racine, les clips du jeu
 * (`clipSample3d`, mélange choisi par `clipSelect3d`) et, par-dessus, le tangage de la visée réparti
 * sur le buste.
 *
 * La pose est une FONCTION DE L'IMAGE : les clips repartent du repos des os qu'ils animent, le
 * tangage s'ajoute à ce qu'ils ont posé ; rien ne s'accumule d'une image à l'autre ; reculer dans le
 * rejeu rend la même pose.
 *
 * Repère du modèle (GLB `spartan`, axes three) : pieds à l'origine, Y vers le haut, la face vers
 * `SPARTAN_FORWARD`, sa droite vers `SPARTAN_RIGHT`. Les clips visent droit devant (`SPARTAN_FORWARD`) :
 * le tangage tourne le buste autour de la droite du modèle, et tout ce que le haut du buste porte (bras,
 * arme, tête) le suit du tangage entier. Les os `b_aim_pitch` / `b_aim_yaw` ne portent aucun sommet.
 */
import * as THREE from 'three'

import { newClipMix, type ClipMix, type ClipRig } from './clipSample3d'
import { aimDirThree } from './tracks3d'

/** La face du modèle au repos (mesurée sur les pieds, la tête et les mains du GLB). */
export const SPARTAN_FORWARD = new THREE.Vector3(1, 0, 0)
const UP = new THREE.Vector3(0, 1, 0)
/** La droite du modèle ; tourner de +θ autour d'elle lève la face. */
export const SPARTAN_RIGHT = SPARTAN_FORWARD.clone().cross(UP)

/** Les os qu'une copie doit porter : le bassin (racine des clips), le buste du tangage, la poignée de l'arme. */
export const SPARTAN_BONES = {
  pelvis: 'b_pelvis',
  spine1: 'b_spine1',
  spine2: 'b_spine2',
  spine3: 'b_spine3',
  rightGrip: 'b_r_grip',
} as const

/**
 * Les clavicules, d'où partent les deux bras : le recul de l'arme (`recoilPose3d`) les déplace d'un
 * même mouvement, après les clips. Facultatives : sans elles, l'arme recule seule dans la main.
 */
const ARM_BONES = { left: 'b_l_clav', right: 'b_r_clav' } as const

/**
 * La part du tangage portée par chaque os, du bas vers le haut ; leur somme fait 1 : le haut du
 * buste, et avec lui les bras et l'arme, tourne du tangage entier.
 */
const PITCH_SHARES: readonly (readonly [keyof typeof SPARTAN_BONES, number])[] = [
  ['spine1', 0.2],
  ['spine2', 0.4],
  ['spine3', 0.4],
]
/** Le tangage au plus (degrés) ; au-delà la pose tient. */
export const PITCH_LIMIT = 75

export interface SpartanRig {
  root: THREE.Object3D
  rightGrip: THREE.Bone
  /** Les os du tangage, du bas vers le haut (`PITCH_SHARES`). */
  joints: THREE.Bone[]
  /** Les clips du jeu liés à cette copie ; null : la copie reste à son repos sous le tangage. */
  clips: ClipRig | null
  /** Les os que la pose touche hors des clips, et leur repos (sans clips : tout le tangage). */
  rest: [THREE.Bone, THREE.Quaternion][]
  /** Les clavicules (`ARM_BONES`), vides si la copie n'en a pas : le recul les déplace. */
  arms: THREE.Bone[]
  /** Leur repos entier (position, orientation, échelle) : chaque pose y repart avant les clips. */
  armRest: [THREE.Bone, THREE.Vector3, THREE.Quaternion, THREE.Vector3][]
}

export interface SpartanPose {
  /** Cap (degrés, 0 = +X Halo, 90 = +Y Halo). */
  h: number
  /** Tangage (degrés, positif vers le haut). */
  p: number
  /** Le mélange de clips de l'image (`clipSelect3d`) ; absent ou null : la pose de repos. */
  mix?: ClipMix | null
}

/** findBones : les os de `root` nommés par `names`, null s'il en manque un. */
export function findBones<K extends string>(
  root: THREE.Object3D,
  names: Readonly<Record<K, string>>,
): Record<K, THREE.Bone> | null {
  const byName = new Map<string, THREE.Bone>()
  root.traverse((o) => {
    if (o instanceof THREE.Bone && !byName.has(o.name)) byName.set(o.name, o)
  })
  const out: Partial<Record<K, THREE.Bone>> = {}
  for (const k of Object.keys(names) as K[]) {
    const bone = byName.get(names[k])
    if (!bone) return null
    out[k] = bone
  }
  return out as Record<K, THREE.Bone>
}

/**
 * rigSpartan : les os pilotés d'une copie du Spartan, liée à ses clips `clips` (null : sans clips).
 * Null sans les os de `SPARTAN_BONES`. La copie doit être à son repos.
 */
export function rigSpartan(root: THREE.Object3D, clips: ClipRig | null): SpartanRig | null {
  const b = findBones(root, SPARTAN_BONES)
  if (!b) return null
  const joints = PITCH_SHARES.map(([name]) => b[name])
  const clav = findBones(root, ARM_BONES)
  const arms = clav ? [clav.left, clav.right] : []
  return {
    root,
    rightGrip: b.rightGrip,
    joints,
    clips,
    rest: joints.map((bone) => [bone, bone.quaternion.clone()]),
    arms,
    armRest: arms.map((bone) => [bone, bone.position.clone(), bone.quaternion.clone(), bone.scale.clone()]),
  }
}

/** spartanYaw : la rotation de la racine autour de Y (radians) qui tourne la face vers le cap `h`. */
export function spartanYaw(h: number): number {
  const d = aimDirThree(h, 0)
  return Math.atan2(-d[2], d[0]) - Math.atan2(-SPARTAN_FORWARD.z, SPARTAN_FORWARD.x)
}

/** Le mélange vide : tous les os des clips à leur repos. */
const REST: ClipMix = newClipMix(0, 0)
const turn = new THREE.Quaternion()
const parentQ = new THREE.Quaternion()
const parentInv = new THREE.Quaternion()

/**
 * poseSpartan pose la copie : cap sur la racine, clips du mélange (ou repos), puis le tangage
 * ajouté au buste autour de la droite du modèle.
 */
export function poseSpartan(rig: SpartanRig, pose: SpartanPose): void {
  rig.root.rotation.set(0, spartanYaw(pose.h), 0)
  for (const [bone, q] of rig.rest) bone.quaternion.copy(q)
  // Le recul d'une image précédente ne survit pas : les clavicules repartent de leur repos.
  for (const [bone, t, q, s] of rig.armRest) {
    bone.position.copy(t)
    bone.quaternion.copy(q)
    bone.scale.copy(s)
  }
  // Sans mélange, les os des clips reviennent aussi au repos : la pose ne dépend que de `pose`.
  rig.clips?.apply(pose.mix ?? REST)
  const pitch = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pose.p, -PITCH_LIMIT, PITCH_LIMIT))
  PITCH_SHARES.forEach(([, share], i) => bendInModel(rig.joints[i], rig.root, pitch * share))
  rig.root.updateMatrixWorld(true)
}

/**
 * bendInModel tourne `bone` de `angle` autour de la droite du modèle (repère de `root`), par-dessus
 * son orientation courante : local' = P⁻¹ · R · P · local, P l'orientation de son parent dans le
 * repère du modèle (lue sur les quaternions locaux, sans matrice ni allocation).
 */
function bendInModel(bone: THREE.Bone, root: THREE.Object3D, angle: number): void {
  if (angle === 0) return
  parentQ.identity()
  for (let o = bone.parent; o && o !== root; o = o.parent) parentQ.premultiply(o.quaternion)
  turn.setFromAxisAngle(SPARTAN_RIGHT, angle)
  // P⁻¹ · R · P, puis appliqué à gauche de l'orientation locale.
  turn.premultiply(parentInv.copy(parentQ).invert()).multiply(parentQ)
  bone.quaternion.premultiply(turn)
}
