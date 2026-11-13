/**
 * recoilPose3d.ts — LE RECUL POSÉ SUR L'ARME DESSINÉE (l'écart de `recoil3d`, repère du modèle
 * d'arme : X canon, Y haut, origine à la poignée, pivot du recul).
 *
 * En 1re personne (et sans Spartan), l'écart va au modèle seul (`recoilModel`) : la caméra ne bouge
 * pas, la visée enregistrée du film porte déjà le mouvement réel du regard. En 3e personne, il va aux
 * deux clavicules (`recoilArms`) : les deux bras et l'arme que la main droite porte bougent d'un même
 * mouvement rigide, après les clips ; les mains restent sur l'arme. La bouche d'un tir se lit sur la
 * même pose (`recoilPoint` pour un modèle porté seul).
 */
import * as THREE from 'three'

import type { Recoil } from './recoil3d'

const euler = new THREE.Euler()
const turn = new THREE.Quaternion()
const shift = new THREE.Vector3()
const ONE = new THREE.Vector3(1, 1, 1)
const weaponW = new THREE.Matrix4()
const delta = new THREE.Matrix4()
const inv = new THREE.Matrix4()
const local = new THREE.Matrix4()
const m = new THREE.Matrix4()

/** recoilRotation : la rotation de l'écart (lève la bouche, puis lacet et roulis), repère du modèle. */
export function recoilRotation(r: Recoil, out: THREE.Quaternion): THREE.Quaternion {
  // Ordre 'ZYX' : Rz(tangage) · Ry(lacet) · Rx(roulis) ; tourner autour de +Z mène le canon (X) vers le haut (Y).
  return out.setFromEuler(euler.set(r.roll, r.yaw, r.pitch, 'ZYX'))
}

/** recoilPoint : le point `p` du modèle (son repère) déplacé par l'écart, dans le repère du modèle au repos. */
export function recoilPoint(p: THREE.Vector3, r: Recoil, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(p).applyQuaternion(recoilRotation(r, turn)).add(shift.set(-r.back, 0, 0))
}

/** recoilModel ajoute l'écart à la tenue que `model` a déjà dans son porteur (position et orientation). */
export function recoilModel(model: THREE.Object3D, r: Recoil): void {
  model.position.add(shift.set(-r.back, 0, 0).applyQuaternion(model.quaternion))
  model.quaternion.multiply(recoilRotation(r, turn))
}

/**
 * recoilArms pose l'écart sur les bras `arms` (les clavicules) d'un Spartan dont l'os `grip` porte
 * l'arme à l'orientation `gripToWeapon` : le mouvement monde T = W · R · W⁻¹ (W l'arme, R l'écart) est
 * appliqué à chaque clavicule dans le repère de son parent. Faux sans clavicules : rien n'est posé.
 */
export function recoilArms(arms: readonly THREE.Bone[], grip: THREE.Object3D, gripToWeapon: THREE.Quaternion, r: Recoil): boolean {
  if (arms.length === 0) return false
  grip.updateWorldMatrix(true, false)
  weaponW.multiplyMatrices(grip.matrixWorld, m.makeRotationFromQuaternion(gripToWeapon))
  local.compose(shift.set(-r.back, 0, 0), recoilRotation(r, turn), ONE)
  delta.multiplyMatrices(weaponW, local).multiply(inv.copy(weaponW).invert())
  for (const bone of arms) {
    const parent = bone.parent
    if (!parent) continue
    parent.updateWorldMatrix(true, false)
    // local' = P⁻¹ · T · P · local
    local.compose(bone.position, bone.quaternion, bone.scale)
    m.multiplyMatrices(inv.copy(parent.matrixWorld).invert(), delta).multiply(parent.matrixWorld).multiply(local)
    m.decompose(bone.position, bone.quaternion, bone.scale)
    bone.updateMatrixWorld(true)
  }
  return true
}
