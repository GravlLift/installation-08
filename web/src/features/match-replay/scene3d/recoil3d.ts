// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * recoil3d.ts — LE RECUL DE L'ARME AU TIR : ce que l'arme dessinée fait à chaque coup.
 *
 * Le clip de tir du jeu ne bouge presque rien (l'index sur la détente) : le moteur ajoute le recul
 * par un ressort. Ici, le recul est une FONCTION DE L'IMAGE : à l'image `f`, l'écart de l'arme est la
 * somme des réponses des tirs récents du tireur, chacune ne dépendant que de son âge. Aucune horloge :
 * reculer, s'arrêter ou sauter dans le rejeu rend le même écart à la même image.
 *
 * La réponse d'un tir (`recoilShape`) : une attaque d'environ une image à 60 Hz (`RECOIL_ATTACK`),
 * puis un retour de ressort amorti qui dépasse un peu sous le repos et y revient exactement à la fin
 * de sa fenêtre (`recovery` du profil). Les tirs se somment, adoucis au-delà d'un coup (`soften`) :
 * le tir automatique devient une petite secousse tenue, jamais une dérive.
 *
 * L'écart est dans le repère du modèle d'arme (X canon, Y haut, origine à la poignée) : `back` recule
 * l'arme le long du canon, `pitch` lève la bouche, `yaw` et `roll` sont un petit bruit tiré du germe de
 * chaque tir (une rafale ne se répète pas). `recoilPose3d` le pose sur l'arme et les bras.
 */

/** La famille de recul d'une arme ; `none` : arme de mêlée, elle ne recule pas. */
export type RecoilKind = 'precision' | 'automatic' | 'heavy' | 'energy' | 'none'

export interface RecoilProfile {
  /** Le recul le long du canon au sommet d'un coup (u ; 1 u ~ 3 m). */
  kick: number
  /** La levée de la bouche au sommet d'un coup (radians). */
  pitch: number
  /** L'amplitude du bruit de lacet et de roulis d'un coup (radians). */
  jitter: number
  /** La durée du retour au repos après l'attaque (s). */
  recovery: number
}

const deg = (d: number) => (d * Math.PI) / 180

/** Le profil de recul de chaque famille : les seuls réglages du recul. */
export const RECOIL_PROFILES: Readonly<Record<RecoilKind, RecoilProfile>> = {
  // Fusils de précision et pistolets : un coup net, bien lisible.
  precision: { kick: 0.012, pitch: deg(3), jitter: deg(0.6), recovery: 0.12 },
  // Automatiques : de petits coups rapides.
  automatic: { kick: 0.006, pitch: deg(1.2), jitter: deg(0.8), recovery: 0.08 },
  // Fusil à pompe, sniper, lance-roquettes et autres armes lourdes : une poussée franche.
  heavy: { kick: 0.024, pitch: deg(6), jitter: deg(1), recovery: 0.15 },
  // Plasma et énergie : plus léger.
  energy: { kick: 0.004, pitch: deg(0.9), jitter: deg(0.5), recovery: 0.09 },
  none: { kick: 0, pitch: 0, jitter: 0, recovery: 0 },
}

/** L'attaque d'un coup : une image à 60 Hz. */
export const RECOIL_ATTACK = 1 / 60
// Le ressort du retour : cos(π u) (1 - u)², u de 0 à 1 sur la fenêtre : il passe sous le repos à
// mi-chemin (dépassement de ~6 %) et rejoint le repos à pente nulle.
const SPRING_TURNS = Math.PI
// Chaque coup varie de force autour de son profil (± AMPLITUDE_SPREAD), au germe du tir.
const AMPLITUDE_SPREAD = 0.15
// La somme des coups est intacte jusqu'à RECOIL_KNEE coups au sommet, puis s'adoucit sans jamais
// passer RECOIL_CAP : sous le feu continu, l'arme tient une secousse bornée.
export const RECOIL_KNEE = 1 + AMPLITUDE_SPREAD
export const RECOIL_CAP = 1.8

/** La famille de recul par la clé stable du libellé d'arme (cf. `weaponClass3d`) ; précision par défaut. */
const KIND_BY_KEY: Readonly<Record<string, RecoilKind>> = {
  hinf_br75: 'precision',
  hinf_vk78_commando: 'precision',
  hinf_bandit: 'precision',
  hinf_sidekick: 'precision',
  hinf_vestige_carbine: 'precision',
  hinf_ma40_ar: 'automatic',
  hinf_ma5k_avenger: 'automatic',
  hinf_turret_machinegun: 'automatic',
  hinf_cqs48_bulldog: 'heavy',
  hinf_heatwave: 'heavy',
  hinf_mangler: 'heavy',
  hinf_s7_sniper: 'heavy',
  hinf_m41_spnkr: 'heavy',
  hinf_skewer: 'heavy',
  hinf_hydra: 'heavy',
  hinf_cindershot: 'heavy',
  hinf_fuel_rod_spnkr: 'heavy',
  hinf_plasma_pistol: 'energy',
  hinf_needler: 'energy',
  hinf_disruptor: 'energy',
  hinf_pulse_carbine: 'energy',
  hinf_sentinel_beam: 'energy',
  hinf_shock_rifle: 'energy',
  hinf_stalker_rifle: 'energy',
  hinf_ravager: 'energy',
  hinf_turret_plasma: 'energy',
  hinf_energy_sword: 'none',
  hinf_gravity_hammer: 'none',
}

/** recoilKindOfKey : la famille de recul d'une arme par la clé de son libellé. */
export function recoilKindOfKey(key: string | undefined): RecoilKind {
  return (key !== undefined && KIND_BY_KEY[key]) || 'precision'
}

/**
 * recoilShape : la réponse d'un coup `age` secondes après le tir (1 au sommet), pour un retour de
 * `recovery` secondes : 0 avant le tir, montée pendant `RECOIL_ATTACK`, ressort amorti ensuite,
 * exactement 0 dès la fin de la fenêtre.
 */
export function recoilShape(age: number, recovery: number): number {
  if (age < 0 || age >= RECOIL_ATTACK + recovery) return 0
  if (age < RECOIL_ATTACK) {
    const x = age / RECOIL_ATTACK
    return 1 - (1 - x) * (1 - x)
  }
  const u = (age - RECOIL_ATTACK) / recovery
  return Math.cos(SPRING_TURNS * u) * (1 - u) * (1 - u)
}

/** recoilWindow : la durée (s) pendant laquelle un coup du profil compte encore. */
export function recoilWindow(profile: RecoilProfile): number {
  return profile.recovery > 0 ? RECOIL_ATTACK + profile.recovery : 0
}

/**
 * soften : une somme de coups (en coups au sommet) telle que l'arme la porte : intacte jusqu'à
 * `RECOIL_KNEE`, puis adoucie vers `RECOIL_CAP`, de même signe.
 */
export function soften(x: number): number {
  const a = Math.abs(x)
  if (a <= RECOIL_KNEE) return x
  const room = RECOIL_CAP - RECOIL_KNEE
  return Math.sign(x) * (RECOIL_KNEE + room * Math.tanh((a - RECOIL_KNEE) / room))
}

/** L'écart de l'arme à une image, dans le repère du modèle d'arme (cf. l'en-tête). */
export interface Recoil {
  back: number
  pitch: number
  yaw: number
  roll: number
}

export function newRecoil(): Recoil {
  return { back: 0, pitch: 0, yaw: 0, roll: 0 }
}

/** clearRecoil : l'arme au repos. */
export function clearRecoil(out: Recoil): Recoil {
  out.back = 0
  out.pitch = 0
  out.yaw = 0
  out.roll = 0
  return out
}

/** recoilActive : l'écart n'est pas le repos. */
export function recoilActive(r: Recoil | null | undefined): r is Recoil {
  return !!r && (r.back !== 0 || r.pitch !== 0 || r.yaw !== 0 || r.roll !== 0)
}

/**
 * signedHash : un nombre de [-1, 1) tiré du germe `seed` et du canal `channel` (mélange entier, celui
 * de la gerbe de `muzzleFlash3d` : des germes voisins n'ont pas de parenté). Copié plutôt qu'importé :
 * ce module reste sans dépendance, l'avatar l'importe.
 */
function signedHash(seed: number, channel: number): number {
  let h = Math.floor(seed * 7 + channel) | 0
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b)
  h ^= h >>> 16
  return (2 * (h >>> 0)) / 4294967296 - 1
}

/**
 * recoilAt écrit dans `out` l'écart à l'image `frame` du tireur dont les tirs sont aux images
 * `frames[from..to)` (triées), de germes `seeds`, à `fps` images par seconde, pour le profil `profile`.
 */
export function recoilAt(
  shots: { frames: ArrayLike<number>; seeds: ArrayLike<number>; from: number; to: number },
  frame: number,
  fps: number,
  profile: RecoilProfile,
  out: Recoil,
): Recoil {
  let kick = 0
  let yaw = 0
  let roll = 0
  for (let i = shots.from; i < shots.to; i++) {
    const s = recoilShape((frame - shots.frames[i]) / fps, profile.recovery)
    if (s === 0) continue
    const seed = shots.seeds[i]
    kick += s * (1 + AMPLITUDE_SPREAD * signedHash(seed, 0))
    yaw += s * signedHash(seed, 1)
    roll += s * signedHash(seed, 2)
  }
  const k = soften(kick)
  out.back = profile.kick * k
  out.pitch = profile.pitch * k
  out.yaw = profile.jitter * soften(yaw)
  out.roll = profile.jitter * soften(roll)
  return out
}
