// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * objectives3dModel.ts — CE QUE LE CALQUE 3D DES OBJECTIFS POSE À UNE IMAGE, sans three.js.
 *
 * Aucune règle n'est réécrite ici : l'état vivant d'une zone, la présence du crâne, la place d'un
 * drapeau, d'une bombe ou d'un objet porté sont ceux de la vue 2D, appelés tels quels. Ce module
 * ne fait que traduire leurs réponses dans le vocabulaire de la 3D :
 *  - une ZONE est visible quand son état le permet, teintée par son propriétaire ;
 *  - un OBJET (drapeau, crâne, bombe) est soit chez son porteur (dans sa main pour le drapeau et
 *    le crâne, au-dessus de lui pour la bombe), soit au sol en un point (x, y) Halo, avec un
 *    indice de hauteur pour chercher le bon étage (`ObjectPlace`).
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
import { flagPlaceAt, flagSpanAt } from '../layers/flagCarriesLayer'
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

/** The marker roles of a CTF base: in game the base is its stand (a map-variant object) and the flag on it. */
const FLAG_BASE_ROLES: ReadonlySet<string> = new Set(['flag_spawn', 'flag_delivery'])

/**
 * markersToDraw: the mode markers the 3D draws as poles. Once the game's flag model is drawn, the
 * flag bases give way to it: their pole stood where the flag stands and hid it.
 */
export function markersToDraw(markers: readonly ObjectiveElementReady[], flagDrawn: boolean): readonly ObjectiveElementReady[] {
  return flagDrawn ? markers.filter((e) => !FLAG_BASE_ROLES.has(e.role)) : markers
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

/** Un drapeau préparé une fois : ses intervalles, et ses portages nommés. */
export interface PreparedFlag {
  carry: ReplayFlagCarryReady
  carries: CarrySpan[]
}

/** prepareFlag — les portages nommés du drapeau, d'où se lit la hauteur d'un drapeau posé. */
export function prepareFlag(carry: ReplayFlagCarryReady): PreparedFlag {
  const carries: CarrySpan[] = []
  for (const sp of carry.spans) if (sp.xuid) carries.push({ xuid: sp.xuid, t0: sp.t0, t1: sp.t1 })
  return { carry, carries }
}

/**
 * flagPlaceAt3d — où est le drapeau à une image (`flagSpanAt`, puis `flagPlaceAt`, la règle
 * commune des objets portés) : dans la main d'un porteur localisé, sinon au sol (sur sa base, là
 * où il est tombé, ou à la dernière place connue d'un porteur perdu). Sans intervalle couvrant
 * l'image, rien : le film ne dit pas où il est.
 */
export function flagPlaceAt3d(f: PreparedFlag, frame: number, posOf: CarrierPosAt, zOf: FeetZAt): ObjectPlace | null {
  const now = flagSpanAt(f.carry, frame)
  if (!now) return null
  const place = flagPlaceAt(now, frame, posOf)
  const carried = now.state === 'carried' || now.state === 'carried_open'
  if (carried && !place.loose && now.xuid) return { on: 'carrier', xuid: now.xuid }
  return { on: 'floor', at: place.at, hint: carryHintAt(f.carries, frame, zOf) }
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
