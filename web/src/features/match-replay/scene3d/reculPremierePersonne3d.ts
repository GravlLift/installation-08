// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * reculPremierePersonne3d.ts — LE RECUL DU RIG DE 1RE PERSONNE (bras et arme animés ensemble).
 *
 * L'écart de l'image (`recoil3d`) se pose sur la racine du rig (la scène glTF, enfant du support de
 * `BrasPremierePersonne3d`), après les clips, d'un seul mouvement rigide : les mains restent sur
 * l'arme. Le repère de cette racine est celui du rig, que le support tourne de `ROTATION_RIG_CAMERA`
 * sous la caméra : +X l'avant de la visée (le canon au repos), +Y le haut, +Z la droite. C'est le
 * repère du modèle d'arme de `recoil3d` : la rotation de l'écart (`recoilRotation`) s'y lit telle
 * quelle, le tangage lève la bouche autour de la droite de la vue, le recul tire vers l'arrière (-X).
 *
 * Le pivot est près de la poignée (la racine de l'arme à l'idle), pas l'œil : autour de l'œil, la
 * levée ferait balayer l'arme à travers l'écran. La racine est recomposée depuis son repos (l'identité
 * de la scène glTF) à chaque image : rien ne s'accumule, une même image donne la même pose.
 */
import * as THREE from 'three'

import { newRecoil, recoilActive, type Recoil } from './recoil3d'
import { recoilRotation } from './recoilPose3d'

/** Le gain du recul en 1re personne, sur `back` et `pitch` : la caméra y est tout près de l'arme. */
export const FP_RECOIL_GAIN = 1.5

// Bacs à sable partagés : la pose tourne à chaque image rendue, sans allocation.
const BAC_RECUL = newRecoil()
const BAC_TOUR = new THREE.Quaternion()
const BAC_PIVOT = new THREE.Vector3()

/**
 * pivotDuRecul : le pivot du recul dans le repère du rig, la racine de l'arme à l'idle
 * (`idleWeapon.position`) ; null sans pose d'arme dans l'index.
 */
export function pivotDuRecul(idleWeapon: { position: readonly [number, number, number] } | undefined): THREE.Vector3 | null {
  return idleWeapon ? new THREE.Vector3(idleWeapon.position[0], idleWeapon.position[1], idleWeapon.position[2]) : null
}

/**
 * poserReculRig recompose la racine du rig `racine` depuis son repos : l'écart `recul` (null ou nul :
 * le repos), `back` et `pitch` multipliés par `FP_RECOIL_GAIN`, tourné autour de `pivot` (repère du
 * rig) puis reculé le long de l'avant : x' = R (x - p) + p - back X.
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
