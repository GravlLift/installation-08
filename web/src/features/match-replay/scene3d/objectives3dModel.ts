/**
 * objectives3dModel.ts — CE QUE LE CALQUE 3D DES OBJECTIFS POSE À UNE IMAGE, sans three.js.
 *
 * Aucune règle n'est réécrite ici : l'état vivant d'une zone, la présence du crâne, la place d'un
 * drapeau, d'une bombe ou d'un objet porté sont ceux de la vue 2D, appelés tels quels. Ce module
 * ne fait que traduire leurs réponses dans le vocabulaire de la 3D :
 *  - une ZONE est visible quand son état le permet, teintée par son propriétaire ;
 *  - un OBJET (drapeau, crâne, bombe) se pose soit au-dessus de son porteur, soit au sol en un
 *    point (x, y) Halo, avec un indice de hauteur pour chercher le bon étage (`ObjectPlace`).
 *
 * L'indice de hauteur vient du porteur le plus proche dans le temps : les canaux d'objet ne
 * publient que (x, y), et le premier sol sous le plafond serait parfois un toit.
 */
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { XY } from '@/lib/replay/replayLogic'
import type {
  ReplayBombCarry,
  ReplayDocumentReady,
  ReplayFlagCarryReady,
  ReplayObjectiveObjectReady,
  ReplaySkullCarry,
  ReplayZoneStateReady,
} from '@/lib/replay/replayNormalize'
import { filmClockTrusted } from '@/lib/replay/scoreTimeline'

import { BOMB_DETONATION_STAT } from '../layers/bombBlastFx'
import { bombCarrierActiveAt, bombGroundAt } from '../layers/bombCarrierLayer'
import { flagPlaceAt, flagSpanAt, homeAnchorOf } from '../layers/flagCarriesLayer'
import type { ObjectiveElementReady } from '../layers/objectivesLayer'
import { skullCarrierActiveAt } from '../layers/skullCarrierLayer'
import { zoneCatalogMatches, zoneElementsOf, zoneLetterOf } from '../layers/zoneStatesLayer'

import { carriedGlyphPlaceAt, type CarrierPosAt } from '../model/carriedGlyphPlace'
import { covers } from '../model/replaySpans'
import { skullPresenceAt } from '../model/skullPresence'

// ---------------------------------------------------------------------------------------------
// Interrupteurs

/**
 * Les interrupteurs par famille du tiroir 2D : `showFlagCarries`, `showVipCrown`,
 * `showBombCarrier`. Le crâne porté n'a pas de marqueur en 3D : son porteur le tient en main.
 */
export interface Objectives3dFamilies {
  flags: boolean
  vipCrown: boolean
  bombCarrier: boolean
}

/** Ce que le calque montre à cette image, famille par famille. */
export interface Objectives3dShown extends Objectives3dFamilies {
  /** Zones et marqueurs du mode (`showModeObjectives` en 2D). */
  zones: boolean
  /** Le crâne au sol : la 2D le peint sans interrupteur. */
  skullFree: boolean
}

/**
 * objectivesShown — sans les interrupteurs par famille, `show.objectives` les commande tous ;
 * avec eux, chaque famille suit le sien comme en 2D, et le crâne au sol reste toujours visible.
 */
export function objectivesShown(objectives: boolean, families: Objectives3dFamilies | null): Objectives3dShown {
  if (!families) {
    return { zones: objectives, skullFree: objectives, flags: objectives, vipCrown: objectives, bombCarrier: objectives }
  }
  return { zones: objectives, skullFree: true, ...families }
}

// ---------------------------------------------------------------------------------------------
// Encres de camp

/**
 * sideInkOf — l'encre d'un camp du film vu du point de vue, ou `null` quand l'allégeance ne le
 * situe pas (camp `-1`, joueur regardé hors du film) : l'appelant sert alors son neutre.
 */
export function sideInkOf(
  allegiance: Pick<FilmAllegiance, 'ofTeam'>,
  teamColorOf: (isAlly: boolean) => string,
): (team: number) => string | null {
  return (team) => {
    const ally = allegiance.ofTeam(team)
    return ally === null ? null : teamColorOf(ally)
  }
}

// ---------------------------------------------------------------------------------------------
// Zones

/** Une zone préparée une fois par liste d'objectifs. */
export interface PreparedZone {
  e: ObjectiveElementReady
  /** Son état vivant, quand le catalogue est joignable (cf. `zoneCatalogMatches`). */
  state: ReplayZoneStateReady | null
  /** La lettre A-C de la zone, ou null (`zoneLetterOf`). */
  letter: string | null
}

export interface PreparedObjectives {
  zones: PreparedZone[]
  markers: ObjectiveElementReady[]
}

/**
 * prepareObjectives — la jointure de `useZoneStates` : les zones dans l'ordre servi (celui que
 * `zoneRef` indexe), et leur état quand le catalogue est joignable.
 */
export function prepareObjectives(
  objectives: readonly ObjectiveElementReady[],
  doc: Pick<ReplayDocumentReady, 'zoneStates' | 'coverage'>,
): PreparedObjectives {
  const zoneElements = zoneElementsOf(objectives)
  const joinable = zoneCatalogMatches(doc.coverage?.zones?.catalog, zoneElements.length)
  const zones = zoneElements.map((e, ref) => {
    const state = joinable ? (doc.zoneStates.find((s) => s.zoneRef === ref) ?? null) : null
    return { e, state, letter: state ? zoneLetterOf(state.letterRank) : null }
  })
  return { zones, markers: objectives.filter((e) => e.kind === 'marker') }
}

/** Les encres de propriétaire et de zone neutre. */
export interface ZoneInks {
  inkOf: (team: number) => string | null
  /** L'encre du « aucun camp » des zones (`inks.zone.fill`). */
  neutral: string
}

/** Une colline exige un intervalle actif ; une autre zone exige un état mesuré. */
export function zoneDisplayInkAt(z: PreparedZone, frame: number, k: ZoneInks): string | null {
  const now = z.state?.spans.find((span) => covers(span, frame))
  if (!now || (z.e.role === 'hill' && !now.active)) return null
  return (now.owner != null ? k.inkOf(now.owner) : null) ?? k.neutral
}

// ---------------------------------------------------------------------------------------------
// Objets portés ou posés

/** La hauteur des pieds (z Halo) d'un joueur à une image, ou null. */
export type FeetZAt = (xuid: string, frame: number) => number | null

/** Où se pose un objet : au-dessus de son porteur, ou au sol en (x, y) Halo. */
export type ObjectPlace =
  | { on: 'carrier'; xuid: string }
  | { on: 'floor'; at: XY; hint: number | null }

/** Une période qui nomme son porteur. */
export interface CarrySpan {
  xuid: string
  t0: number
  t1: number
}

/**
 * carryHintAt — l'indice de hauteur d'un objet posé : les pieds du porteur de la période la plus
 * proche dans le temps, lus à l'image de cette période la plus proche de `frame`.
 */
export function carryHintAt(carries: readonly CarrySpan[], frame: number, zOf: FeetZAt): number | null {
  let best: CarrySpan | null = null
  let bestGap = Infinity
  for (const c of carries) {
    const gap = frame < c.t0 ? c.t0 - frame : frame > c.t1 ? frame - c.t1 : 0
    if (gap < bestGap) {
      bestGap = gap
      best = c
    }
  }
  return best ? zOf(best.xuid, Math.min(Math.max(frame, best.t0), best.t1)) : null
}

/** Un drapeau préparé une fois : ses portages nommés, sa base, la hauteur de sa base. */
export interface PreparedFlag {
  carry: ReplayFlagCarryReady
  carries: CarrySpan[]
  home: XY | null
  homeHint: number | null
}

/**
 * prepareFlag — la base vient des intervalles `home` (`homeAnchorOf`) ; sa hauteur, des pieds du
 * joueur qui prend le drapeau au départ d'un intervalle `home`.
 */
export function prepareFlag(carry: ReplayFlagCarryReady, zOf: FeetZAt): PreparedFlag {
  const carries: CarrySpan[] = []
  let homeHint: number | null = null
  carry.spans.forEach((sp, i) => {
    if (sp.xuid) carries.push({ xuid: sp.xuid, t0: sp.t0, t1: sp.t1 })
    const next = carry.spans[i + 1]
    if (homeHint === null && sp.state === 'home' && next?.xuid) homeHint = zOf(next.xuid, next.t0)
  })
  return { carry, carries, home: homeAnchorOf(carry), homeHint }
}

/** Le drapeau à une image : le glyphe vivant, et sa base vide quand il n'y est pas. */
export interface FlagPlaces {
  team: number
  live: ObjectPlace
  /** Fanion creux : `carried_open` (fin de portage non datée). */
  hollow: boolean
  home: ObjectPlace | null
}

/**
 * flagPlacesAt — l'état du drapeau (`flagSpanAt`) et sa place (`flagPlaceAt`, qui applique la
 * règle commune des objets portés). Porté par un porteur localisé : au-dessus de lui ; sinon au
 * sol. Sans intervalle couvrant l'image, rien.
 */
export function flagPlacesAt(f: PreparedFlag, frame: number, posOf: CarrierPosAt, zOf: FeetZAt): FlagPlaces | null {
  const now = flagSpanAt(f.carry, frame)
  if (!now) return null
  const place = flagPlaceAt(now, frame, posOf)
  const carried = now.state === 'carried' || now.state === 'carried_open'
  const live: ObjectPlace =
    carried && !place.loose && now.xuid
      ? { on: 'carrier', xuid: now.xuid }
      : { on: 'floor', at: place.at, hint: carryHintAt(f.carries, frame, zOf) }
  const home: ObjectPlace | null =
    f.home && now.state !== 'home' ? { on: 'floor', at: f.home, hint: f.homeHint } : null
  return { team: f.carry.team, live, hollow: now.state === 'carried_open', home }
}

/** Les sources du crâne : ses vies libres, ses portages, son socle (`skullSocle`). */
export interface SkullSources {
  lives: readonly ReplayObjectiveObjectReady[]
  carries: readonly ReplaySkullCarry[]
  socle: XY | null
}

/** skullPlaceAt — la présence unique du crâne (`skullPresenceAt`), posée en 3D. */
export function skullPlaceAt(s: SkullSources, frame: number, posOf: CarrierPosAt, zOf: FeetZAt): ObjectPlace | null {
  if (s.lives.length === 0 && s.carries.length === 0) return null
  const presence = skullPresenceAt(s.lives, s.carries, frame, s.socle, posOf)
  if (presence.state === 'free') return { on: 'floor', at: presence.at, hint: carryHintAt(s.carries, frame, zOf) }
  if (presence.state === 'absent') return null
  const carry = skullCarrierActiveAt(s.carries, frame)[0]
  return carry ? { on: 'carrier', xuid: carry.xuid } : null
}

/**
 * bombExplosionsOf — les images des explosions d'Assaut, triées ; `null` sans horloge de
 * confiance : la bombe au sol ne se pose pas (la garde de `useReplayBombCarrier`).
 */
export function bombExplosionsOf(
  doc: Pick<ReplayDocumentReady, 'objectives'> & Parameters<typeof filmClockTrusted>[0],
): readonly number[] | null {
  if (!filmClockTrusted(doc)) return null
  const out: number[] = []
  for (const a of doc.objectives) {
    if (a.stat === BOMB_DETONATION_STAT) out.push(a.t)
  }
  return out.sort((a, b) => a - b)
}

/**
 * bombPlaceAt — la règle de `drawBombCarrier` : portée, sur son porteur (libre à sa dernière
 * position connue quand le porteur n'en a plus, `carriedGlyphPlaceAt`) ; sinon au sol, au point
 * de son lâcheur à l'instant du lâcher (`bombGroundAt`).
 */
export function bombPlaceAt(
  carries: readonly ReplayBombCarry[],
  explosions: readonly number[] | null,
  frame: number,
  posOf: CarrierPosAt,
  zOf: FeetZAt,
): ObjectPlace | null {
  const active = bombCarrierActiveAt(carries, frame)[0]
  if (active) {
    const place = carriedGlyphPlaceAt(posOf, active, frame, null)
    if (place.state === 'absent') return null
    if (place.state === 'carried') return { on: 'carrier', xuid: active.xuid }
    return { on: 'floor', at: place.at, hint: carryHintAt([active], frame, zOf) }
  }
  const ground = bombGroundAt(carries, explosions, frame)
  if (!ground) return null
  const at = posOf(ground.xuid, ground.t1)
  return at ? { on: 'floor', at, hint: zOf(ground.xuid, ground.t1) } : null
}
