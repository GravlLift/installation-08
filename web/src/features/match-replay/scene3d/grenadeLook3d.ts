// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * grenadeLook3d.ts — A GRENADE'S LOOK BY ITS RANK: a pure function from the grenade type to its
 * drawing.
 *
 * `flights3d` reads from here the two decisions that can vary by type — the flight's shape
 * (only the plasma grenade departs from the frag look for now: a glowing orb, blue-white core
 * and saturated blue halo) and the nature of the detonation (`fxInk`'s own vocabulary) — so
 * that, once Dynamo and Spike get their own look, this file changes, not the layer.
 *
 * The orb is drawn like the shock shot's beam (`shots3d`): a second, wider lobe, at a fraction
 * of the core's intensity. The pulse is a pure, periodic function of time: the same frame
 * always renders the same orb, forward as much as backward.
 */
import type { FxTint } from '../layers/fxInk'
import { explosionTintOf } from '../model/grenadeFx'

/** The plasma grenade's rank in `GrenadeLabels` (0 frag, 1 plasma, 2 dynamo, 3 spike). */
export const PLASMA_RANK = 1

/** A grenade's flight shape: the game model (or the spherical head), or the plasma orb. */
export type GrenadeFlightLook = 'model' | 'orb'

/** A grenade's look: its flight's shape, and the nature of its detonation. */
export interface GrenadeLook {
  flight: GrenadeFlightLook
  tint: FxTint
}

/** grenadeLookOf — the grenade-type -> look mapping, the sole holder of this correspondence. */
export function grenadeLookOf(rank: number): GrenadeLook {
  if (rank === PLASMA_RANK) return { flight: 'orb', tint: 'plasma_cool' }
  return { flight: 'model', tint: explosionTintOf(rank) }
}

/** The orb's core radius (u): that of a frag's head. */
export const PLASMA_CORE_RADIUS = 0.02

/**
 * The weapon shots whose projectile flies as a glowing orb in the shot's tint (the plasma
 * grenade's look), by weapon key, with the orb's core radius (u). The Fuel Rod SPNKr fires one
 * large green fuel rod: the radius (0.06 u, about 18 cm, halo twice that) is an ESTIMATE read off
 * the game's look, not a value from its tags. Any other shot projectile keeps the small head.
 */
export const SHOT_ORB_RADIUS: Readonly<Record<string, number>> = {
  hinf_fuel_rod_spnkr: 0.06,
}
/** The halo: a second lobe at this multiple of the core's radius. */
export const PLASMA_HALO_MULT = 2
/** The halo, at this fraction of the core's intensity. */
export const PLASMA_HALO_DIM = 0.7
/** The orb's pulse frequency (pulses per second). */
export const PLASMA_PULSE_RATE = 1.5
/** The pulse's amplitude: intensity and radius vary by this fraction around their average. */
export const PLASMA_PULSE_DEPTH = 0.3
/** The core's blue-white: this fraction of incandescence within the plasma tint. */
export const PLASMA_CORE_MIX = 0.3

/**
 * plasmaPulse — the orb's pulse intensity, a pure function of time in seconds: a value between
 * 0 and 1, periodic with period `1 / PLASMA_PULSE_RATE`.
 */
export function plasmaPulse(seconds: number): number {
  return 0.5 + 0.5 * Math.sin(seconds * PLASMA_PULSE_RATE * Math.PI * 2)
}
