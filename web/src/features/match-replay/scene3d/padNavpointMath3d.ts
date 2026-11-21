// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * padNavpointMath3d.ts — pure math for the pad navpoint's screen projection and
 * off-screen docking.
 *
 * The game draws each pad's icon on screen (raised above the item with a thin line)
 * and, when the item is off screen or behind the camera, docks the icon on an
 * invisible oval around the screen in the item's direction.
 *
 * The oval is fitted to the in-game screenshot (F1): with the player facing away
 * from all pads, the icons bunch at the upper-left and upper-right of the screen,
 * on an oval centred on the screen with a horizontal radius of about 0.86 and a
 * vertical radius of about 0.62 (in normalised screen coordinates, 0-1).
 */

/** The docking oval's centre and radii, in normalised screen coordinates (0-1). */
export const DOCK_CENTER_X = 0.5
export const DOCK_CENTER_Y = 0.38
export const DOCK_RADIUS_X = 0.38
export const DOCK_RADIUS_Y = 0.28

/**
 * projectToScreen — projects a world point to normalised screen coordinates (0-1,
 * origin at the top-left) using the camera's projection and view matrices.
 * Returns null when the point is behind the camera.
 */
export function projectToScreen(
  point: readonly [number, number, number],
  cameraMatrixWorld: readonly number[],
  projectionMatrix: readonly number[],
): [number, number] | null {
  // Transform the point by the view matrix (cameraMatrixWorld inverse).
  // cameraMatrixWorld is a 4x4 column-major matrix: [m0,m4,m8,m12, m1,m5,m9,m13, m2,m6,m10,m14, m3,m7,m11,m15]
  // The view matrix is the inverse of the camera's world matrix. For a camera
  // with position (px,py,pz) and orientation, we can use the camera's
  // matrixWorld elements directly.
  //
  // Actually, three.js's Vector3.project(camera) does:
  //   vector.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix)
  // So we need the camera's matrixWorldInverse. But we only have cameraMatrixWorld.
  // Let me use a different approach: compute the view-space coordinates manually.
  //
  // The camera's world matrix columns are:
  //   col0 = (m0, m1, m2, m3) = right
  //   col1 = (m4, m5, m6, m7) = up
  //   col2 = (m8, m9, m10, m11) = forward (looking direction)
  //   col3 = (m12, m13, m14, m15) = position
  //
  // View space = camera space. A point P in world space is in view space as:
  //   v = (P - pos) rotated by the camera's inverse orientation.
  // The inverse orientation is the transpose of the rotation part.
  //
  // For a perspective camera with vertical FOV, the projection is:
  //   ndc.x = v.x / v.z * (vFov / aspect)  [v.z is negative when in front]
  //   ndc.y = v.y / v.z * vFov
  //
  // But we don't have the FOV or aspect here. Let me use a simpler approach:
  // use the camera's matrixWorldInverse if available, or compute it.

  // Extract camera position and orientation from the world matrix.
  const px = cameraMatrixWorld[12]
  const py = cameraMatrixWorld[13]
  const pz = cameraMatrixWorld[14]

  // Camera's rotation (transpose of the 3x3 rotation part).
  const r00 = cameraMatrixWorld[0], r01 = cameraMatrixWorld[4], r02 = cameraMatrixWorld[8]
  const r10 = cameraMatrixWorld[1], r11 = cameraMatrixWorld[5], r12 = cameraMatrixWorld[9]
  const r20 = cameraMatrixWorld[2], r21 = cameraMatrixWorld[6], r22 = cameraMatrixWorld[10]

  // Translate the point to camera space.
  const dx = point[0] - px
  const dy = point[1] - py
  const dz = point[2] - pz

  // Rotate by the camera's inverse orientation (transpose).
  const vx = r00 * dx + r01 * dy + r02 * dz
  const vy = r10 * dx + r11 * dy + r12 * dz
  const vz = r20 * dx + r21 * dy + r22 * dz

  // In three.js, the camera looks down -Z, so vz < 0 means in front.
  if (vz >= 0) return null // behind the camera

  // Project to NDC using the projection matrix.
  // The projection matrix is 4x4 column-major.
  // ndc.x = (pm[0] * vx + pm[4] * vy + pm[8] * vz + pm[12]) / (-vz)
  // ndc.y = (pm[1] * vx + pm[5] * vy + pm[9] * vz + pm[13]) / (-vz)
  const w = -vz
  const ndcX = (projectionMatrix[0] * vx + projectionMatrix[4] * vy + projectionMatrix[8] * vz + projectionMatrix[12]) / w
  const ndcY = (projectionMatrix[1] * vx + projectionMatrix[5] * vy + projectionMatrix[9] * vz + projectionMatrix[13]) / w

  // Convert NDC (-1 to 1) to screen (0 to 1).
  const sx = (ndcX + 1) / 2
  const sy = (1 - ndcY) / 2
  return [sx, sy]
}

/**
 * dockOnOval — given a screen direction (unit vector from screen centre), places
 * the icon on the docking oval. `dirX` and `dirY` are the normalised direction
 * from the screen centre to the item (or the mirrored direction when the item is
 * behind the camera).
 */
export function dockOnOval(dirX: number, dirY: number): [number, number] {
  // Normalise the direction.
  const len = Math.sqrt(dirX * dirX + dirY * dirY)
  if (len < 1e-8) return [DOCK_CENTER_X, DOCK_CENTER_Y]
  const nx = dirX / len
  const ny = dirY / len
  // The oval: x = cx + rx * cos(theta), y = cy + ry * sin(theta)
  // where theta = atan2(ny, nx).
  return [
    DOCK_CENTER_X + DOCK_RADIUS_X * nx,
    DOCK_CENTER_Y + DOCK_RADIUS_Y * ny,
  ]
}

/**
 * navpointScreenPosition — computes the screen position of a pad navpoint's icon.
 *
 * @param worldPos - the pad item's world position (three.js coordinates).
 * @param camWorld - the camera's 4x4 world matrix (column-major, 16 elements).
 * @param projMatrix - the camera's 4x4 projection matrix (column-major, 16 elements).
 * @param viewW - the view width in pixels.
 * @param viewH - the view height in pixels.
 * @returns the icon's screen position in pixels [x, y], and whether the item is
 *   on screen (not docked).
 */
export function navpointScreenPosition(
  worldPos: readonly [number, number, number],
  camWorld: readonly number[],
  projMatrix: readonly number[],
  viewW: number,
  viewH: number,
): { x: number; y: number; docked: boolean } {
  const screen = projectToScreen(worldPos, camWorld, projMatrix)
  if (!screen) {
    // Behind the camera: dock in the mirrored direction.
    // Direction from camera to item, mirrored (negated Z component in view space).
    // We use the world direction projected onto the camera's right and up vectors.
    const px = camWorld[12], py = camWorld[13], pz = camWorld[14]
    const dx = worldPos[0] - px, dy = worldPos[1] - py, dz = worldPos[2] - pz
    // Camera's right and up (from the world matrix).
    const rx = camWorld[0], ry = camWorld[1], rz = camWorld[2]
    const ux = camWorld[4], uy = camWorld[5], uz = camWorld[6]
    // Direction in camera space (mirrored: negate Z to flip behind -> front).
    const dirX = rx * dx + ry * dy + rz * dz
    const dirY = ux * dx + uy * dy + uz * dz
    // Mirror the vertical component for behind-the-camera.
    const [dx2, dy2] = dockOnOval(dirX, -dirY)
    return { x: dx2 * viewW, y: dy2 * viewH, docked: true }
  }
  // Check if the point is within the screen (with a small margin).
  const margin = 0.02
  if (screen[0] < -margin || screen[0] > 1 + margin || screen[1] < -margin || screen[1] > 1 + margin) {
    // Off screen: dock on the oval in the item's direction from the screen centre.
    const dirX = screen[0] - DOCK_CENTER_X
    const dirY = screen[1] - DOCK_CENTER_Y
    const [dx2, dy2] = dockOnOval(dirX, dirY)
    return { x: dx2 * viewW, y: dy2 * viewH, docked: true }
  }
  // On screen: return the projected position.
  return { x: screen[0] * viewW, y: screen[1] * viewH, docked: false }
}
