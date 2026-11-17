// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * soundListener3d.ts — L'AUDITEUR SPATIAL D'UNE CAMÉRA 3D : sa place et son cap, en repère de la
 * carte, pour le son spatial du rejeu (`soundSpatial.ts`).
 *
 * La caméra vit en repère three.js ; la conversion est celle de `toThree` (`tracks3d.ts`) :
 * three (X, Y, Z) = carte (X, -Z). Le cap est l'azimut du regard projeté sur le plan horizontal,
 * en degrés : 0 vers +X, 90 vers +Y — la même convention que `aimDirThree` tourne en direction
 * de caméra.
 */
import * as THREE from 'three'
import type { SoundListener } from '../sound/soundSpatial'

/**
 * listenerOfCamera — la position et le cap d'une caméra, traduits en auditeur du son spatial.
 *
 * `getWorldPosition` / `getWorldDirection` rendent des vecteurs three.js : la position (X, Y, Z)
 * devient carte (X, -Z), le regard (dX, dZ) horizontal devient (dX, -dZ), et le cap est
 * l'atan2 de ces deux composantes, en degrés.
 */
export function listenerOfCamera(camera: THREE.Camera): SoundListener {
  const p = camera.getWorldPosition(new THREE.Vector3())
  const d = camera.getWorldDirection(new THREE.Vector3())
  const heading = (Math.atan2(-d.z, d.x) * 180) / Math.PI
  return { x: p.x, y: -p.z, heading }
}
