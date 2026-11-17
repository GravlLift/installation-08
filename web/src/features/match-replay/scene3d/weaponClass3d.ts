// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * weaponClass3d.ts — A WEAPON'S ANIMATION CLASS: the game's own word that picks the
 * Spartan's clips (`combat:<class>:...`, see `meshproto.AnimationsSpartan`).
 *
 * The `weap` tag carries its class, which the view does not read yet (a StringID at a
 * variable offset, see the plan): the table below gives it by the document's weapon label's
 * stable key (`weaponLabels[id].key`, the one from
 * `config/titles/halo_infinite/mappings/replay_labels.toml`). A weapon missing from the
 * table, with no label or no key, is held like a rifle. The Oddball's skull and the CTF's
 * flag are not rack weapons: their carrier takes the object's class from how it's carried
 * (`carriedObjectAt`), not from this table (`CARRIED_OBJECT_CLASS`).
 */
import type { CarriedObject } from '../model/weaponInHand'

export type WeaponClass = 'rifle' | 'pistol' | 'missile' | 'sword' | 'hammer' | 'ball' | 'turret'

/**
 * The animation class of an objective object held in hand, as its `weap` tag declares it
 * (`himap.EtiquettesAnimationArme`): the skull `0017592c` is `ball`; the flag `2a392328` is
 * `hammer` with the type `ctf`, and the Spartan's graphs carry no `ctf` clip of their own, so its
 * carrier plays the hammer's.
 */
export const CARRIED_OBJECT_CLASS: Readonly<Record<CarriedObject, WeaponClass>> = { skull: 'ball', flag: 'hammer' }

/** The fallback class: the one with the full clip set. */
export const DEFAULT_WEAPON_CLASS: WeaponClass = 'rifle'

const BY_KEY: Readonly<Record<string, WeaponClass>> = {
  hinf_ma40_ar: 'rifle',
  hinf_br75: 'rifle',
  hinf_vk78_commando: 'rifle',
  hinf_bandit: 'rifle',
  hinf_cqs48_bulldog: 'rifle',
  hinf_s7_sniper: 'rifle',
  hinf_stalker_rifle: 'rifle',
  hinf_heatwave: 'rifle',
  hinf_sentinel_beam: 'rifle',
  hinf_pulse_carbine: 'rifle',
  hinf_cindershot: 'rifle',
  hinf_mangler: 'rifle',
  hinf_shock_rifle: 'rifle',
  hinf_vestige_carbine: 'rifle',
  hinf_ma5k_avenger: 'rifle',
  hinf_sidekick: 'pistol',
  hinf_plasma_pistol: 'pistol',
  hinf_needler: 'pistol',
  hinf_disruptor: 'pistol',
  hinf_skewer: 'missile',
  hinf_fuel_rod_spnkr: 'missile',
  hinf_m41_spnkr: 'missile',
  hinf_gravity_hammer: 'hammer',
  hinf_energy_sword: 'sword',
  hinf_turret_machinegun: 'turret',
  hinf_turret_plasma: 'turret',
}

/** weaponClassOfKey: a weapon's class by its label's key; a rifle by default. */
export function weaponClassOfKey(key: string | undefined): WeaponClass {
  return (key !== undefined && BY_KEY[key]) || DEFAULT_WEAPON_CLASS
}
