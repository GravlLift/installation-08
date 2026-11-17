// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * body3d.ts — the PLAYER'S DIMENSIONS in the 3D scene, in Halo world units (1 u = 3.048 m),
 * measured from the feet. The capsule, the camera, and the action layers (weapon muzzle,
 * objects carried above the head) share them.
 */

/** Radius and length of the capsule's cylinder; body center above the feet. */
export const BODY_RADIUS = 0.12
export const BODY_LENGTH = 0.45
export const BODY_CENTER = 0.345
/** The eye: ~1.9 m, a Spartan's. */
export const EYE_HEIGHT = 0.62
/** Aiming starts from the top of the torso (above the body center). */
export const AIM_HEIGHT = 0.27
/** The weapon muzzle: at aim height. */
export const MUZZLE_HEIGHT = BODY_CENTER + AIM_HEIGHT
/** The top of the head: what a player carries above themselves sits there. */
export const HEAD_TOP = BODY_CENTER + BODY_RADIUS + BODY_LENGTH / 2
/** Crouched, the body loses this much height. */
export const CROUCH_DROP = 0.27
/** The player's label. */
export const TAG_HEIGHT = 0.85
