// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * padNavpointMath3d.ts — pure math for the pad navpoint's screen projection and
 * off-screen docking.
 *
 * The game draws each pad's icon on screen (raised above the item with a thin line)
 * and, when the item is off screen or behind the camera, docks the icon on an
 * invisible oval around the screen in the item's direction.
 *
 * The oval is fitted to the in-game screenshot, not read from the game data: with the
 * player facing away from all pads, the icons bunch at the upper-left and upper-right
 * of the screen (F1). The uihg docking values are not decoded yet, so the oval's centre
 * and radii below are chosen to match that screenshot.
 */
import * as THREE from 'three'

/** The docking oval's centre and radii, in normalised screen coordinates (0-1). */
export const DOCK_CENTER_X = 0.5
export const DOCK_CENTER_Y = 0.38
export const DOCK_RADIUS_X = 0.38
export const DOCK_RADIUS_Y = 0.28

/**
 * projectToScreen — projects a world point to normalised screen coordinates (0-1,
 * origin at the top-left) using the camera. Returns null when the point is behind
 * the camera.
 */
export function projectToScreen(
  point: readonly [number, number, number],
  camera: THREE.Camera,
): [number, number] | null {
  const v = new THREE.Vector3(point[0], point[1], point[2]).project(camera)
  const behind = new THREE.Vector3(point[0], point[1], point[2]).applyMatrix4(camera.matrixWorldInverse)
  if (behind.z >= 0) return null
  return [(v.x + 1) / 2, (1 - v.y) / 2]
}

/**
 * dockOnOval — given a screen direction (unit vector from the oval centre), places
 * the icon on the docking oval. `dirX` and `dirY` are the normalised direction
 * from the oval centre to the item (or the mirrored direction when the item is
 * behind the camera).
 */
export function dockOnOval(dirX: number, dirY: number): [number, number] {
  const len = Math.sqrt(dirX * dirX + dirY * dirY)
  if (len < 1e-8) return [DOCK_CENTER_X, DOCK_CENTER_Y]
  const nx = dirX / len
  const ny = dirY / len
  return [
    DOCK_CENTER_X + DOCK_RADIUS_X * nx,
    DOCK_CENTER_Y + DOCK_RADIUS_Y * ny,
  ]
}
