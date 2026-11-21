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

/**
 * ovalAngle — the parameter angle (radians) on the docking oval for a screen
 * direction (unit vector from the oval centre).
 */
export function ovalAngle(dirX: number, dirY: number): number {
  const len = Math.sqrt(dirX * dirX + dirY * dirY)
  if (len < 1e-8) return 0
  return Math.atan2((dirY / len) / DOCK_RADIUS_Y, (dirX / len) / DOCK_RADIUS_X)
}

/**
 * ovalPoint — the normalised screen position on the docking oval at parameter
 * angle `angle` (radians).
 */
export function ovalPoint(angle: number): [number, number] {
  return [
    DOCK_CENTER_X + DOCK_RADIUS_X * Math.cos(angle),
    DOCK_CENTER_Y + DOCK_RADIUS_Y * Math.sin(angle),
  ]
}

/**
 * ovalRadius — the local radius of the docking oval at parameter angle `angle`
 * (radians), in normalised screen coordinates.
 */
export function ovalRadius(angle: number): number {
  const cx = DOCK_RADIUS_X * Math.cos(angle)
  const cy = DOCK_RADIUS_Y * Math.sin(angle)
  const sx = -DOCK_RADIUS_X * Math.sin(angle)
  const sy = DOCK_RADIUS_Y * Math.cos(angle)
  const s = Math.sqrt(sx * sx + sy * sy)
  if (s < 1e-12) return DOCK_RADIUS_X
  return Math.sqrt(cx * cx + cy * cy) / s
}

/**
 * spreadDocked — given the parameter angles (radians) of docked icons on the
 * oval, returns adjusted angles so that neighbouring icons are at least
 * `minGap` apart along the oval (arc length = angle × local radius), keeping
 * their order and keeping the group centred on its original mean angle.
 *
 * `minGap` is the minimum arc-length gap between neighbouring icons, in the
 * same units as the oval's radii (normalised screen coordinates).
 *
 * The algorithm: sort by angle, build a forward-pass chain with the gap
 * enforced, and centre it on the mean (the mean of a centred chain equals the
 * target). When the wrap gap (last-to-first around 2π) is violated, the chain
 * is compressed to the span that leaves exactly `minGap` for the wrap, and the
 * result is re-centred on the mean.
 */
export function spreadDocked(angles: number[], minGap: number): number[] {
  const n = angles.length
  if (n <= 1) return angles.slice()
  const mean = angles.reduce((s, a) => s + a, 0) / n
  const sorted = angles.map((a, i) => ({ a, i })).sort((x, y) => x.a - y.a)

  // Forward pass: chain positions relative to the first, gap enforced.
  const chain = new Array<number>(n)
  chain[0] = 0
  for (let k = 1; k < n; k++) {
    chain[k] = Math.max(sorted[k].a - sorted[0].a, chain[k - 1] + minGap)
  }
  const span = chain[n - 1]

  // Centre the chain on the mean.
  let pos = new Array<number>(n)
  for (let k = 0; k < n; k++) {
    pos[k] = chain[k] + (mean - span / 2)
  }

  // Wrap gap: angular gap from last to first around 2π.
  const wrap = Math.PI * 2 - span
  if (wrap < minGap) {
    // Compress to the span that leaves exactly minGap for the wrap.
    const maxSpan = Math.PI * 2 - minGap
    const scale = maxSpan / span
    pos = new Array<number>(n)
    for (let k = 0; k < n; k++) {
      pos[k] = chain[k] * scale + (mean - maxSpan / 2)
    }
  }

  const res = new Array<number>(n)
  for (let k = 0; k < n; k++) {
    res[sorted[k].i] = pos[k]
  }
  return res
}
