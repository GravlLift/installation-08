// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * knockbackFx.ts — THE TIMING OF A REPULSOR PUSH: the window and the easing of its effect.
 *
 * THE SOURCE is the document (schema 94): `knockbacks`, one entry per pushed player — (t,
 * slot), the author `by` and the imposed velocity `vx/vy/vz`, read from the pair of messages
 * the film writes (`EquipmentObjectKnockedBack` then `EquipmentKnockbackPlayer`). No
 * threshold, no trajectory reading to decide: the push IS published.
 *
 * The 3D view's push arrow (`scene3d/equipment3d`, analysis aid `knockbackArrows`) is shown over
 * this window. The 2D drawing of the wave and of the trail was retired with the 2D layer.
 */

/** DURATION OF THE EFFECT, in real time of the match: a brief breath, like the dash of the
 * thruster. */
export const KNOCKBACK_FX_MS = 520

const WAVE_ALPHA = 0.85
/** Under reduced motion: the effect is placed, full reach, constant opacity. */
const WAVE_ALPHA_STATIC = 0.5

/**
 * waveProgress: reach (part of the full effect) and presence at this age, or `null` outside
 * the window. easeOutCubic stretch, like the dash and the shockwave of the explosion.
 */
export function waveProgress(
  ageMs: number,
  reducedMotion: boolean,
): { reach: number; alpha: number } | null {
  if (!(ageMs >= 0) || ageMs > KNOCKBACK_FX_MS) return null
  if (reducedMotion) return { reach: 1, alpha: WAVE_ALPHA_STATIC }
  const p = ageMs / KNOCKBACK_FX_MS
  return { reach: 1 - Math.pow(1 - p, 3), alpha: (1 - p) * WAVE_ALPHA }
}
