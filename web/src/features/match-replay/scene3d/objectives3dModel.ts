// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * objectives3dModel.ts — WHAT THE 3D OBJECTIVES LAYER PLACES AT A FRAME, with no three.js.
 *
 * No rule is rewritten here: a zone's live state, the skull's presence, and the place of a flag,
 * bomb or carried object are the 2D view's own, called as they are. This module only translates
 * their answers into 3D's vocabulary:
 *  - a ZONE is visible when its state allows it, tinted by its owner;
 *  - an OBJECT (flag, skull, bomb) is either with its carrier (in hand for the flag and the
 *    skull, above them for the bomb), or on the ground at a Halo (x, y) point, with a height
 *    hint to find the right floor (`ObjectPlace`).
 *
 * The height hint comes from the carrier closest in time: object channels only publish (x, y),
 * and the first floor under the ceiling would sometimes be a roof.
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
// Toggles

/**
 * The 2D drawer's per-family toggles: `showFlagCarries`, `showVipCrown`, `showBombCarrier`. The
 * carried skull has no marker in 3D: its carrier holds it in hand.
 */
export interface Objectives3dFamilies {
  flags: boolean
  vipCrown: boolean
  bombCarrier: boolean
}

/** What the layer shows at this frame, family by family. */
export interface Objectives3dShown extends Objectives3dFamilies {
  /** Mode zones and markers (`showModeObjectives` in 2D). */
  zones: boolean
  /** The skull on the ground: 2D paints it with no toggle. */
  skullFree: boolean
}

/**
 * objectivesShown — without the per-family toggles, `show.objectives` drives all of them; with
 * them, each family follows its own as in 2D, and the skull on the ground always stays visible.
 */
export function objectivesShown(objectives: boolean, families: Objectives3dFamilies | null): Objectives3dShown {
  if (!families) {
    return { zones: objectives, skullFree: objectives, flags: objectives, vipCrown: objectives, bombCarrier: objectives }
  }
  return { zones: objectives, skullFree: true, ...families }
}

// ---------------------------------------------------------------------------------------------
// Side inks

/**
 * sideInkOf — the ink of a film side as seen from the viewpoint, or `null` when allegiance does
 * not place it (side `-1`, a watched player outside the film): the caller then serves its neutral.
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

/** A zone prepared once per objectives list. */
export interface PreparedZone {
  e: ObjectiveElementReady
  /** Its live state, when the catalog is reachable (see `zoneCatalogMatches`). */
  state: ReplayZoneStateReady | null
  /** The zone's A-C letter, or null (`zoneLetterOf`). */
  letter: string | null
}

export interface PreparedObjectives {
  zones: PreparedZone[]
  markers: ObjectiveElementReady[]
}

/**
 * prepareObjectives — the join `useZoneStates` performs: zones in the served order (the one
 * `zoneRef` indexes), and their state when the catalog is reachable.
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

/** The owner ink and the neutral zone ink. */
export interface ZoneInks {
  inkOf: (team: number) => string | null
  /** The "no side" ink for zones (`inks.zone.fill`). */
  neutral: string
}

/** A hill requires an active span; another zone requires a measured state. */
export function zoneDisplayInkAt(z: PreparedZone, frame: number, k: ZoneInks): string | null {
  const now = z.state?.spans.find((span) => covers(span, frame))
  if (!now || (z.e.role === 'hill' && !now.active)) return null
  return (now.owner != null ? k.inkOf(now.owner) : null) ?? k.neutral
}

// ---------------------------------------------------------------------------------------------
// Carried or placed objects

/** A player's feet height (Halo z) at a frame, or null. */
export type FeetZAt = (xuid: string, frame: number) => number | null

/** Where an object sits: above its carrier, or on the ground at a Halo (x, y). */
export type ObjectPlace =
  | { on: 'carrier'; xuid: string }
  | { on: 'floor'; at: XY; hint: number | null }

/** A span that names its carrier. */
export interface CarrySpan {
  xuid: string
  t0: number
  t1: number
}

/**
 * carryHintAt — a placed object's height hint: the feet of the carrier from the span closest in
 * time, read at that span's frame closest to `frame`.
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

/** A flag prepared once: its spans, and its named carries. */
export interface PreparedFlag {
  carry: ReplayFlagCarryReady
  carries: CarrySpan[]
}

/** prepareFlag — the flag's named carries, from which a placed flag's height is read. */
export function prepareFlag(carry: ReplayFlagCarryReady): PreparedFlag {
  const carries: CarrySpan[] = []
  for (const sp of carry.spans) if (sp.xuid) carries.push({ xuid: sp.xuid, t0: sp.t0, t1: sp.t1 })
  return { carry, carries }
}

/**
 * flagPlaceAt3d — where the flag is at a frame (`flagSpanAt`, then `flagPlaceAt`, the shared rule
 * for carried objects): in a located carrier's hand, else on the ground (on its base, where it
 * fell, or at a lost carrier's last known spot). With no span covering the frame, nothing: the
 * film does not say where it is.
 */
export function flagPlaceAt3d(f: PreparedFlag, frame: number, posOf: CarrierPosAt, zOf: FeetZAt): ObjectPlace | null {
  const now = flagSpanAt(f.carry, frame)
  if (!now) return null
  const place = flagPlaceAt(now, frame, posOf)
  const carried = now.state === 'carried' || now.state === 'carried_open'
  if (carried && !place.loose && now.xuid) return { on: 'carrier', xuid: now.xuid }
  return { on: 'floor', at: place.at, hint: carryHintAt(f.carries, frame, zOf) }
}

/** The skull's sources: its free lives, its carries, its stand (`skullSocle`). */
export interface SkullSources {
  lives: readonly ReplayObjectiveObjectReady[]
  carries: readonly ReplaySkullCarry[]
  socle: XY | null
}

/** skullPlaceAt — the skull's single presence (`skullPresenceAt`), placed in 3D. */
export function skullPlaceAt(s: SkullSources, frame: number, posOf: CarrierPosAt, zOf: FeetZAt): ObjectPlace | null {
  if (s.lives.length === 0 && s.carries.length === 0) return null
  const presence = skullPresenceAt(s.lives, s.carries, frame, s.socle, posOf)
  if (presence.state === 'free') return { on: 'floor', at: presence.at, hint: carryHintAt(s.carries, frame, zOf) }
  if (presence.state === 'absent') return null
  const carry = skullCarrierActiveAt(s.carries, frame)[0]
  return carry ? { on: 'carrier', xuid: carry.xuid } : null
}

/**
 * bombExplosionsOf — the frames of Assault's explosions, sorted; `null` without a trusted clock:
 * the bomb on the ground does not get placed (the guard from `useReplayBombCarrier`).
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
 * bombPlaceAt — the rule from `drawBombCarrier`: carried, on its carrier (free at its last known
 * position once the carrier no longer has one, `carriedGlyphPlaceAt`); else on the ground, at its
 * dropper's point at the moment of the drop (`bombGroundAt`).
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
