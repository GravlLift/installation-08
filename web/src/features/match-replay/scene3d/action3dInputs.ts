// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * action3dInputs.ts — WHAT THE PAGE HANDS TO THE 3D VIEW TO DRAW THE ACTION.
 *
 * The lists the 2D canvas has already baked (shots, thread-aligned kills), the map's objectives,
 * the theme's inks, the drawer's toggles, and the per-frame identity resolvers: the 3D view
 * recomputes none of them, it only adds height. The drawer's toggles apply to both views:
 * hiding shots hides them everywhere.
 *
 * This module carries only types: the page's bundle does not pull in three.js because of it.
 */
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'

import type { ReplayLocale } from '../i18n/i18n'
import type { ObjectiveElementReady } from '../layers/objectivesLayer'
import type { ReplayInks } from '../layers/useReplayInks'
import type { ReplayKill } from '../model/killFeedLogic'
import type { ShotFxEntry } from '../model/shotFx'
import type { Aids3d } from './aids3d'

/** The drawer's toggles that the 3D view follows. */
export interface Action3dShow {
  shots: boolean
  kills: boolean
  weaponPads: boolean
  groundWeapons: boolean
  groundWeaponsSpecialOnly: boolean
  groundWeaponsStarting: boolean
  placements: boolean
  vehicles: boolean
  /** Mode objectives and zone state. */
  objectives: boolean
  /**
   * Carried objects, each under its own toggle (as in 2D). Not the skull: its carrier holds it
   * in hand (the `weap` grip-handling weapon), with no marker above the head.
   */
  flags: boolean
  vipCrown: boolean
  bombCarrier: boolean
}

export interface Action3dInputs {
  shotFx: readonly ShotFxEntry[]
  kills: readonly ReplayKill[]
  mapObjectives: readonly ObjectiveElementReady[]
  /** Ally or enemy, read from the film from the page's own viewpoint (zone colors). */
  allegiance: Pick<FilmAllegiance, 'ofTeam' | 'ofXuid'>
  /**
   * Ally or enemy as seen by the PAGE's player (the one at this address), regardless of which
   * viewpoint is being followed: the team outline and the shield glow take their color from it.
   */
  pageAllegiance: Pick<FilmAllegiance, 'ofXuid'>
  inks: ReplayInks
  show: Action3dShow
  /** How long a shot lingers, in frames (the same value as the 2D flash). */
  shotHoldFrames: number
  /** The document's native frame rate: 3D-specific durations (a bullet's flight) convert from it. */
  framesPerSecond: number
  /** How long a death lingers, in frames (the same value as the 2D cross). */
  deathHoldFrames: number
  colorOfSlot: (slot: number, frame: number) => string | null
  colorOfXuid: (xuid: string) => string | null
  nameOfSlot: (slot: number, frame: number) => string | null
  nameOfXuid: (xuid: string) => string | null
  /** The pawn rule: a player no longer holding a sheet (a bot that was relieved) has no position. */
  seatedOfXuid: (xuid: string, frame: number) => boolean
  locale: ReplayLocale
  /** The 3D drawer's analysis aids (`aids3d`), off by default; the 3D view sets them. */
  aids: Aids3d
}

/** What the page bakes for the 3D view: everything except the analysis aids, which the 3D view reads itself. */
export type PageAction3dInputs = Omit<Action3dInputs, 'aids'>
