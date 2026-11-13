/**
 * action3dInputs.ts — CE QUE LA PAGE DONNE À LA 3D POUR DESSINER L'ACTION.
 *
 * Les listes que le canvas 2D a déjà cuites (tirs, kills du fil recalés), les objectifs de la
 * carte, les encres du thème, les interrupteurs du tiroir et les résolutions d'identité par image :
 * la 3D n'en recalcule aucune, elle n'y ajoute que la hauteur. Les interrupteurs du tiroir valent
 * pour les deux vues : masquer les tirs les masque partout.
 *
 * Ce module ne porte que des types : le paquet de la page n'embarque pas three.js pour autant.
 */
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'

import type { ReplayLocale } from '../i18n/i18n'
import type { ObjectiveElementReady } from '../layers/objectivesLayer'
import type { ReplayInks } from '../layers/useReplayInks'
import type { ReplayKill } from '../model/killFeedLogic'
import type { ShotFxEntry } from '../model/shotFx'
import type { Aids3d } from './aids3d'

/** Les interrupteurs du tiroir que la 3D suit. */
export interface Action3dShow {
  shots: boolean
  kills: boolean
  weaponPads: boolean
  groundWeapons: boolean
  groundWeaponsSpecialOnly: boolean
  groundWeaponsStarting: boolean
  placements: boolean
  vehicles: boolean
  /** Objectifs du mode et état des zones. */
  objectives: boolean
  /**
   * Les objets portés, chacun sous son interrupteur (comme la 2D). Pas le crâne : son porteur le
   * tient en main (arme `weap` des prises en main), sans marqueur au-dessus de la tête.
   */
  flags: boolean
  vipCrown: boolean
  bombCarrier: boolean
}

export interface Action3dInputs {
  shotFx: readonly ShotFxEntry[]
  kills: readonly ReplayKill[]
  mapObjectives: readonly ObjectiveElementReady[]
  /** Allié ou adverse, lu dans le film depuis le point de vue de la page (couleurs des zones). */
  allegiance: Pick<FilmAllegiance, 'ofTeam' | 'ofXuid'>
  /**
   * Allié ou adverse vu du joueur de la PAGE (celui de l'adresse), quel que soit le point de vue
   * suivi : le contour d'équipe et l'éclat du bouclier en prennent la couleur.
   */
  pageAllegiance: Pick<FilmAllegiance, 'ofXuid'>
  inks: ReplayInks
  show: Action3dShow
  /** Rémanence d'un tir, en images (la même que l'éclair de la 2D). */
  shotHoldFrames: number
  /** Cadence native du document : les durées propres à la 3D (vol d'une balle) s'y convertissent. */
  framesPerSecond: number
  /** Rémanence d'une mort, en images (la même que la croix de la 2D). */
  deathHoldFrames: number
  colorOfSlot: (slot: number, frame: number) => string | null
  colorOfXuid: (xuid: string) => string | null
  nameOfSlot: (slot: number, frame: number) => string | null
  nameOfXuid: (xuid: string) => string | null
  /** La règle du pion : un joueur qui ne tient plus de fiche (bot relevé) n'a pas de position. */
  seatedOfXuid: (xuid: string, frame: number) => boolean
  locale: ReplayLocale
  /** Les repères d'analyse du tiroir 3D (`aids3d`), éteints par défaut ; la vue 3D les pose. */
  aids: Aids3d
}

/** Ce que la page cuit pour la 3D : tout sauf les repères d'analyse, que la vue 3D lit elle-même. */
export type PageAction3dInputs = Omit<Action3dInputs, 'aids'>
