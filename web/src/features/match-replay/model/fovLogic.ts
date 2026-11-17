// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * fovLogic.ts — THE FIELD OF VIEW of the 3D replay, pure functions of the frame.
 *
 * The game setting (70 to 120) is a HORIZONTAL angle at 16:9: the game keeps the vertical angle
 * when the window is narrower (the sides are cropped). The 3D camera carries the
 * VERTICAL equivalent angle, computed here; the scope zoom multiplies from this base
 * (`scopeLogic`), and the first-person rig (`FirstPersonArms3d`) counter-scales to
 * its setting base (`viewmodelScale`) to keep the weapon size placed at the eye.
 */

/** The lower bound of the game field setting, in horizontal degrees at 16:9. */
export const GAME_FOV_MIN = 70
/** The upper bound of the game field setting, in horizontal degrees at 16:9. */
export const GAME_FOV_MAX = 120
/** The default field setting, in horizontal degrees at 16:9. */
export const GAME_FOV_DEFAULT = 100

/**
 * verticalFovOf gives the VERTICAL angle in degrees of the horizontal field `gameFovDeg` at 16:9:
 * the half-fields compare by tangent, and the ratio of the half-fields is 16:9.
 */
export function verticalFovOf(gameFovDeg: number): number {
  const demi = (gameFovDeg * Math.PI) / 360
  return (2 * Math.atan(Math.tan(demi) * (9 / 16)) * 180) / Math.PI
}

/**
 * viewmodelScale gives the scale factor of a rig set to a vertical field
 * `viewmodelFovDeg` to carry it under a vertical field `cameraFovDeg`: the projected size
 * of an object at fixed distance follows the half-field (tangent).
 */
export function viewmodelScale(cameraFovDeg: number, viewmodelFovDeg: number): number {
  return Math.tan((cameraFovDeg * Math.PI) / 360) / Math.tan((viewmodelFovDeg * Math.PI) / 360)
}
