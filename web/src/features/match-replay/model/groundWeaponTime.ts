// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * groundWeaponTime.ts — WHEN a ground weapon is seen, and WITH WHAT CERTAINTY.
 *
 * THE DATA (schema 27, `groundWeapons`) carries three bounds and not two, and that is the whole subject
 * of this file: `t0` the appearance, `t1` the last PROOF of presence, `t1max` the first
 * proof of ABSENCE. On a `seen` end — the object stops being recorded by the keyframes — the
 * disappearance is an INTERVAL, never an instant: the film does not say where, between the two, it
 * took place.
 *
 * HENCE THE TWO DISPLAY REGIMES, and they say exactly what the measurement says:
 *   - FULL from `t0` to `t1` — as long as a proof holds, the object is there;
 *   - FADED from `t1` to `t1max` — nothing proves it anymore, nothing refutes it yet. The opacity
 *     descends to the floor, and it is this DESCENT that reads as a reservation: a
 *     hard cut at `t1` would assert a disappearance no one saw, and holding the object
 *     full until `t1max` would assert a presence nothing attests anymore;
 *   - NOTHING after `t1max` — the bound is a proof of absence, it is not crossed.
 *
 * ON `pickup` AND `open`, THE SECOND REGIME DOES NOT EXIST: the document publishes `t1max == t1` there,
 * so the fade window is empty and the object passes from full to nothing. This is intended — a
 * pickup is dated to the millisecond, it has no reservation to carry; an `open` end runs
 * to the last frame of the document, there is nothing after it.
 *
 * This whole file is PURE: no React, no canvas, therefore testable — same division as
 * `weaponPadTime.ts` facing `weaponPadsLayer.ts`.
 */
import type { ReplayGroundWeapon } from '@/lib/api/types'

/**
 * Opacity of a ground weapon whose presence is PROVEN.
 *
 * BELOW 1, AND THAT IS A READING CHOICE: an abandoned weapon is a scenery object, not the
 * subject. It must be seen without competing with the player markers or the pedestals, which are
 * painted on top (cf. the order of the layers in `ReplayCanvas`).
 */
export const GROUND_WEAPON_ALPHA_FULL = 0.8

/**
 * Opacity at the end of the fade — the FLOOR, reached at `t1max`.
 *
 * NONZERO UNTIL THE LAST FRAME of the interval: at zero, the object would extinguish before
 * `t1max` for the eye, and the measured upper bound would no longer read. It is worth a quarter of full:
 * enough to distinguish « it may still be there » from « it is there », little enough that one does
 * not confuse it with an established presence.
 */
export const GROUND_WEAPON_ALPHA_FADED = 0.2

/** What the render needs to know about a ground weapon at a given frame. */
export interface GroundWeaponPresence {
  /** Opacity of the vignette, within [GROUND_WEAPON_ALPHA_FADED, GROUND_WEAPON_ALPHA_FULL]. */
  alpha: number
  /**
   * True within the interval ]t1, t1max]: the disappearance is not dated, the object fades out.
   *
   * PUBLISHED SEPARATELY FROM THE OPACITY because it is not the same information: the opacity is
   * a screen setting, this is a state of the MEASUREMENT — a caller that would want to say
   * it differently (a label, a dotted line) does not have to re-derive it from a floating point number.
   */
  vanishing: boolean
}

/**
 * groundWeaponPresenceAt returns the presence of ONE ground weapon at a frame, or `null` when it
 * should not be drawn (not yet appeared, or past its first proof of absence).
 *
 * THE DESCENT IS LINEAR, and that is not a model: the film says NOTHING about the way the
 * object disappeared in the interval. A learned curve would suggest a knowledge we
 * do not have; a straight ramp reads as what it is — « somewhere in there ».
 */
export function groundWeaponPresenceAt(
  item: ReplayGroundWeapon,
  frame: number,
): GroundWeaponPresence | null {
  if (frame < item.t0) return null
  if (frame <= item.t1) return { alpha: GROUND_WEAPON_ALPHA_FULL, vanishing: false }
  // STRICT UPPER BOUND: `t1max` is a proof of ABSENCE, crossing it would assert a
  // presence the film refutes. `t1max <= t1` (`pickup` and `open` ends) falls here too.
  if (frame > item.t1max) return null
  const span = item.t1max - item.t1
  const done = span > 0 ? (frame - item.t1) / span : 1
  return {
    alpha: GROUND_WEAPON_ALPHA_FULL + (GROUND_WEAPON_ALPHA_FADED - GROUND_WEAPON_ALPHA_FULL) * done,
    vanishing: true,
  }
}

/**
 * groundWeaponsAt returns the VISIBLE weapons at a frame, each with its presence.
 *
 * A FULL SWEEP PER FRAME, and that is accepted: the layer counts a few tens per
 * match (the pedestal weapons, for their part, stay in `weaponPads`), while the trajectories carry
 * thousands of points. A per-frame index would cost more to maintain than it saves.
 */
export function groundWeaponsAt(
  items: readonly ReplayGroundWeapon[],
  frame: number,
): { item: ReplayGroundWeapon; presence: GroundWeaponPresence }[] {
  const out: { item: ReplayGroundWeapon; presence: GroundWeaponPresence }[] = []
  for (const item of items) {
    const presence = groundWeaponPresenceAt(item, frame)
    if (presence) out.push({ item, presence })
  }
  return out
}
