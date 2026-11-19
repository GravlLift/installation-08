// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * soundListener3d.ts — A 3D CAMERA'S SPATIAL LISTENER: its position and heading, in map frame,
 * for the replay's spatial sound (`soundSpatial.ts`).
 *
 * The camera lives in three.js's frame; the conversion is `toThree`'s own (`tracks3d.ts`):
 * three (X, Y, Z) = map (X, -Z). The heading is the look direction's azimuth projected onto the
 * horizontal plane, in degrees: 0 toward +X, 90 toward +Y — the same convention `aimDirThree`
 * turns toward a camera direction.
 */
import * as THREE from 'three'
import type { SoundListener } from '../sound/soundSpatial'

/**
 * listenerOfCamera — a camera's position and heading, translated into a spatial sound listener.
 *
 * `getWorldPosition` / `getWorldDirection` return three.js vectors: position (X, Y, Z) becomes
 * map (X, -Z, Y) — three's Y is the map's height — the horizontal look (dX, dZ) becomes
 * (dX, -dZ), and the heading is the atan2 of those two components, in degrees.
 */
export function listenerOfCamera(camera: THREE.Camera): SoundListener {
  const p = camera.getWorldPosition(new THREE.Vector3())
  const d = camera.getWorldDirection(new THREE.Vector3())
  const heading = (Math.atan2(-d.z, d.x) * 180) / Math.PI
  return { x: p.x, y: -p.z, z: p.y, heading }
}
