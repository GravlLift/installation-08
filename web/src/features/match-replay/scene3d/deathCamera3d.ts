// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * deathCamera3d.ts — THE FIRST-PERSON DEATH CAMERA: once the tracked player has no sample at the
 * frame, the eye leaves their head to follow their ragdoll in third person, at the third-person
 * camera's distance and height, along the player's heading at their last frame alive (the body
 * never rotates the camera). With no known body, the eye keeps its last frame alive.
 */
import * as THREE from 'three'

import { aimDirThree } from './tracks3d'
import { fallPlacement, fallPose } from './fall3d'
import type { Corpse } from './corpses3d'
import type { RagdollBake } from './ragdollBake3d'

/**
 * bodyPosition: the ragdoll's feet at `t` seconds since death, written to `out`. Baked: the body
 * is at rest, at the bake's spot; otherwise: the game's fall (`fallPlacement`).
 */
export function bodyPosition(fall: Corpse, t: number, bake: RagdollBake | null, out: THREE.Vector3): THREE.Vector3 {
  if (bake) return out.copy(bake.feet)
  const pose = fallPose(t, fall.kind, TMP_POSE)
  fallPlacement(fall.at, fall.dir, pose, out)
  return out
}

/** What the first-person eye follows at a frame: the player (alive), the body (dead), or nothing (dead with no body). */
export type PovSubject3d =
  | { kind: 'fp' }
  | { kind: 'corpse'; feet: THREE.Vector3; heading: number }
  | { kind: 'hold' }

/**
 * povSubject: the first-person camera's subject at a frame. Alive, the player; dead with a known
 * body, the body followed in third person at heading `heading` (last frame alive); dead with no
 * body, nothing (the eye stays where it was).
 */
export function povSubject(alive: boolean, body: THREE.Vector3 | null, heading: number): PovSubject3d {
  if (alive) return { kind: 'fp' }
  if (body) return { kind: 'corpse', feet: body, heading }
  return { kind: 'hold' }
}

/** The death camera's settings: those of the third-person camera. */
export interface DeathCameraOpts {
  /** The eye pulled back from the body's head by this distance (u). */
  distance: number
  /** The eye raised by this height above the body's head (u). */
  rise: number
  /** The eye's height above the body's feet (u). */
  eyeHeight: number
}

/** The death camera's placement: the eye (camera position) and its look-at point. */
export interface DeathCameraPose {
  position: THREE.Vector3
  look: THREE.Vector3
}

/**
 * deathCameraPose: the eye behind and above the body (the third-person camera's distance and
 * elevation), along heading `heading` (constant, the body never rotates the camera); the gaze
 * reaches ahead of the eye. Written to `out`.
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
