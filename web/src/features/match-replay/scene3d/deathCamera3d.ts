/**
 * deathCamera3d.ts — LA CAMÉRA DE MORT EN 1RE PERSONNE : quand le joueur suivi n'a plus d'échantillon
 * à l'image, l'œil quitte sa tête pour suivre son corps inerte en 3e personne, à la distance et à la
 * hauteur de la caméra 3e, avec le cap du joueur à sa dernière image en vie (le corps ne fait pas
 * tourner la caméra). Sans corps connu, l'œil garde sa dernière image en vie.
 */
import * as THREE from 'three'

import { aimDirThree } from './tracks3d'
import { fallPlacement, fallPose } from './fall3d'
import type { Corpse } from './corpses3d'
import type { RagdollBake } from './ragdollBake3d'

/**
 * bodyPosition : les pieds du corps inerte à `t` secondes de la mort, écrits dans `out`. Cuit : le
 * corps est au repos, à la place de la cuisson ; sinon : la chute du jeu (`fallPlacement`).
 */
export function bodyPosition(fall: Corpse, t: number, bake: RagdollBake | null, out: THREE.Vector3): THREE.Vector3 {
  if (bake) return out.copy(bake.feet)
  const pose = fallPose(t, fall.kind, TMP_POSE)
  fallPlacement(fall.at, fall.dir, pose, out)
  return out
}

/** Ce que l'œil suit en 1re personne à une image : le joueur (en vie), le corps (mort), ou rien (mort sans corps). */
export type PovSubject3d =
  | { kind: 'fp' }
  | { kind: 'corpse'; feet: THREE.Vector3; heading: number }
  | { kind: 'hold' }

/**
 * povSubject : le sujet de la caméra de 1re personne à une image. En vie, le joueur ; mort avec un
 * corps connu, le corps suivi en 3e personne au cap `heading` (dernière image en vie) ; mort sans
 * corps, rien (l'œil reste où il était).
 */
export function povSubject(alive: boolean, body: THREE.Vector3 | null, heading: number): PovSubject3d {
  if (alive) return { kind: 'fp' }
  if (body) return { kind: 'corpse', feet: body, heading }
  return { kind: 'hold' }
}

/** Les réglages de la caméra de mort : ceux de la caméra 3e personne. */
export interface DeathCameraOpts {
  /** L'œil reculé de la tête du corps de cette distance (u). */
  distance: number
  /** L'œil surélevé de cette hauteur au-dessus de la tête du corps (u). */
  rise: number
  /** La hauteur de l'œil au-dessus des pieds du corps (u). */
  eyeHeight: number
}

/** Le placement de la caméra de mort : l'œil (position de la caméra) et son point de visée. */
export interface DeathCameraPose {
  position: THREE.Vector3
  look: THREE.Vector3
}

/**
 * deathCameraPose : l'œil derrière et au-dessus du corps (distance et élévation de la caméra 3e), le
 * long du cap `heading` (constant, le corps ne fait pas tourner la caméra) ; le regard porte devant
 * l'œil. Écrit dans `out`.
 */
export function deathCameraPose(feet: THREE.Vector3, heading: number, o: DeathCameraOpts, out: DeathCameraPose): DeathCameraPose {
  const eye = TMP_EYE.copy(feet).add(TMP_UP.set(0, o.eyeHeight, 0))
  const d = TMP_DIR.set(...aimDirThree(heading, 0))
  out.look.copy(eye).addScaledVector(d, 10)
  out.position.copy(eye).addScaledVector(d, -o.distance).add(TMP_UP.set(0, o.rise, 0))
  return out
}

const TMP_POSE = { u: 0, slide: 0, lift: 0 }
const TMP_UP = new THREE.Vector3()
const TMP_DIR = new THREE.Vector3()
const TMP_EYE = new THREE.Vector3()
