// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * useReplayTiming — ALL THE REPLAY'S DURATIONS, converted once per document.
 *
 * WHY THIS FILE EXISTS. The replay canvas carries a size debt FROZEN by a threshold
 * (`max-lines` eslint, R5): any addition there happens by EXTRACTION, never by piling on —
 * that is the maneuver the threshold exists to enforce, and this is the fourth time it has
 * served that purpose (useReplayInks, the grenade thumbnails, useReplayWeaponPads before
 * it). The R3 batch extends the death cross and had to write down why: the timing settings
 * and their conversion therefore move here, with their justifications.
 *
 * EVERYTHING IS DECLARED IN REAL TIME, NEVER IN FRAME COUNT. The film's sampling rate is
 * chosen at build time and can change without the playback changing: a duration written in
 * frames would start lying the day it moves. The conversion lives here, once per document,
 * and no one else redoes it.
 */
import { useMemo } from 'react'

import { DYNAMO_REST_HOLD_MS, GRENADE_REST_HOLD_MS } from '../model/grenadeFx'
import { framesPerSecond, msToFrames } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import type { MarkerTiming } from '../layers/replayMarkers'

/**
 * Afterglows of the one-off events, in real time — the POC's values, and they DIFFER: a
 * SHOT is a brief flash (0.6 s — its brevity is what makes it readable: at 1.4 s the streak
 * lingered dim and blended into the map, measurement from recalibration 2.2), a THROW and a
 * DEATH hold for 1.4 s because they carry more meaning than a detonation.
 */
const SHOT_HOLD_MS = 600
const EVENT_HOLD_MS = 1_400

/**
 * Timing settings of the players layer. Values carried over from the POC, where they were
 * tuned on screen; their measured justification is at the top of replayMarkers.ts.
 */
const TIMING_MS = {
  trail: 7_000,
  aimHold: 5_000,
  /**
   * THE DEATH CROSS PERSISTS FOR 2.5 s since 2026-08-18 (A1: "a longer persistence").
   * 1.5 s was the POC value: at 4x, a cross lived less than ten frames and the death went
   * unnoticed. TWO durations were proposed on the board (2.5 s and 4 s); the question has
   * been SETTLED since 2026-08-20 — 4 s clutters the map, 2.5 s stays. The constant that
   * kept the longer option on hand is removed along with this decision.
   */
  death: 2_500,
  spawn: 800,
} as const

/** Durations of a grenade's end of flight, in frames: short halo, long Dynamo field. */
export interface GrenadeRestWindow {
  holdHalo: number
  holdDynamo: number
}

export interface ReplayTiming {
  /** NATIVE rate of the document, before the speed multiplier. */
  baseFps: number
  /** Trail, aim cone hold, death cross, spawn ring — in frames. */
  timing: MarkerTiming
  /** Afterglow of a throw or a death, in frames. */
  eventHoldFrames: number
  /** Afterglow of a shot, in frames. */
  shotHoldFrames: number
  /** Windows of a grenade's end of flight, in frames. */
  restWindow: GrenadeRestWindow
}

/** useReplayTiming converts all of the replay's durations for this document. */
export function useReplayTiming(doc: ReplayDocumentReady): ReplayTiming {
  return useMemo(
    () => ({
      baseFps: framesPerSecond(doc),
      timing: {
        trail: msToFrames(TIMING_MS.trail, doc),
        aimHold: msToFrames(TIMING_MS.aimHold, doc),
        death: msToFrames(TIMING_MS.death, doc),
        spawn: msToFrames(TIMING_MS.spawn, doc),
      },
      eventHoldFrames: msToFrames(EVENT_HOLD_MS, doc),
      shotHoldFrames: msToFrames(SHOT_HOLD_MS, doc),
      restWindow: {
        holdHalo: msToFrames(GRENADE_REST_HOLD_MS, doc),
        holdDynamo: msToFrames(DYNAMO_REST_HOLD_MS, doc),
      },
    }),
    [doc],
  )
}

/** The DECLARED durations, in ms — exposed for tests and the board, never for rendering. */
export const REPLAY_TIMING_MS = { ...TIMING_MS, event: EVENT_HOLD_MS, shot: SHOT_HOLD_MS } as const
