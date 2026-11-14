/**
 * weaponClass3d.ts — LA CLASSE D'ANIMATION D'UNE ARME : le mot du jeu qui choisit les clips du
 * Spartan (`combat:<classe>:...`, cf. `meshproto.AnimationsSpartan`).
 *
 * Le tag `weap` porte sa classe, que la vue ne lit pas encore (StringID à décalage variable, cf. plan) :
 * la table ci-dessous la donne par la clé stable du libellé d'arme du document (`weaponLabels[id].key`,
 * celle de `config/titles/halo_infinite/mappings/replay_labels.toml`). Une arme absente de la table,
 * sans libellé ou sans clé, se tient comme un fusil. Le crâne de l'Oddball et le drapeau du CTF ne
 * sont pas des armes de la rangée : leur porteur prend la classe de l'objet par son portage
 * (`carriedObjectAt`), pas par cette table (`CARRIED_OBJECT_CLASS`).
 */
import type { CarriedObject } from '../model/armeEnMain'

export type WeaponClass = 'rifle' | 'pistol' | 'missile' | 'sword' | 'hammer' | 'ball' | 'turret'

/**
 * The animation class of an objective object held in hand, as its `weap` tag declares it
 * (`himap.EtiquettesAnimationArme`): the skull `0017592c` is `ball`; the flag `2a392328` is
 * `hammer` with the type `ctf`, and the Spartan's graphs carry no `ctf` clip of their own, so its
 * carrier plays the hammer's.
 */
export const CARRIED_OBJECT_CLASS: Readonly<Record<CarriedObject, WeaponClass>> = { skull: 'ball', flag: 'hammer' }

/** La classe de repli : celle qui a le jeu de clips complet. */
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

/** weaponClassOfKey : la classe d'une arme par la clé de son libellé ; le fusil par défaut. */
export function weaponClassOfKey(key: string | undefined): WeaponClass {
  return (key !== undefined && BY_KEY[key]) || DEFAULT_WEAPON_CLASS
}
