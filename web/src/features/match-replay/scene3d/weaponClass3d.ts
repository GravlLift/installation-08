/**
 * weaponClass3d.ts — LA CLASSE D'ANIMATION D'UNE ARME : le mot du jeu qui choisit les clips du
 * Spartan (`combat:<classe>:...`, cf. `meshproto.AnimationsSpartan`).
 *
 * Le tag `weap` porte sa classe, que la vue ne lit pas encore (StringID à décalage variable, cf. plan) :
 * la table ci-dessous la donne par la clé stable du libellé d'arme du document (`weaponLabels[id].key`,
 * celle de `config/titles/halo_infinite/mappings/replay_labels.toml`). Une arme absente de la table,
 * sans libellé ou sans clé, se tient comme un fusil. Le crâne de l'Oddball n'est pas une arme de la
 * rangée : son porteur prend la classe `ball` par son portage (`skullCarries`), pas par cette table.
 */

export type WeaponClass = 'rifle' | 'pistol' | 'missile' | 'sword' | 'hammer' | 'ball' | 'turret'

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
