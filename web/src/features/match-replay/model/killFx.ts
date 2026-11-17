// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * killFx.ts — THE DEATH EFFECTS ON THE MAP, oriented killer -> victim.
 *
 * WHY THIS LAYER EXISTS, AND WHY IT IS SEPARATE FROM THE SHOTS (POC rule, kept
 * as is): a SHOT event does not carry a victim — its stroke goes in the
 * aimed direction, when it is readable. The feed of DEATHS, it, names the killer AND the
 * victim, and their two positions are re-read in the trajectories at the instant of the
 * death. So it is here, and here only, that an effect can point to a true victim.
 *
 * THE 89/93 RULE (POC measurement, carried here): the effect is ORIENTED only when the pair
 * is COMPLETE — the two positions re-read. Victim alone, killer alone: a non-oriented
 * marker, never an invented axis. On the reference film: 89 deaths out of 93 with the pair
 * complete, 3 victim alone, 1 killer alone, 0 without position.
 *
 * THE FAMILY comes from `doc.killEffects` (weapon_key -> family, table of the title): the kills
 * of the feed carry a weapon_key resolved on the database side, not a film weapon identifier. A missing key
 * (generic melee, unknown source) falls on the neutral rendering — never that of a
 * neighboring weapon.
 *
 * THE TWO POSITIONS ARE THOSE OF THE CARRIER RESOLVER (`carrierPosition.ts`, 2026-09-05):
 * a player killed at the wheel, or as a passenger, explodes ON HIS VEHICLE. A biped attached to it no
 * longer replicates its world position and its track interpolates in a straight line through the scenery —
 * the best-dated death effect of the match was therefore placed, for those deaths, at a place where
 * no one was. The re-reading primitive (`posOfPlayerAt`) was repatriated to its canonical module
 * (`livesPosition.ts`) the same day: this file maintains NO COPY of
 * the index of lives anymore, and the import cycle that justified this copy no longer exists.
 *
 * No React, no canvas: pure logic, tested (killFx.test.ts).
 */
import { buildCarrierPosAt } from './carrierPosition'
import type { ReplayKill } from './killFeedLogic'
import { buildLivesByXuid, deathWindowFrames } from './livesPosition'
import { familyOf, type ShotFamily } from '../layers/shotEffects'
import { isAliveAt, msToFrames, trackWindow } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayTrackReady } from '../../../lib/replay/replayNormalize'

/**
 * MELEE threshold, in world meters: below it, the victim is within reach of the gesture and the linking
 * arc is drawn. It is a CHOICE backed by a measurement (POC): median 0.4-0.5 m for
 * the sword and melee, 23 m for the sniper — the threshold is placed in the interval separating
 * these two populations.
 */
export const MELEE_LINK_MAX_M = 8

/** A death effect, precomputed in WORLD coordinates (the px conversion depends on the framing). */
export interface KillFxEntry {
  /** Frame of the kill on the replay grid. */
  frame: number
  /** Origin of the effect (the killer — or the victim when only he is missing). */
  x: number
  y: number
  /** Position of the victim, ONLY when the pair is complete. */
  vx: number | null
  vy: number | null
  /**
   * The PLACE OF THE DEATH: the position of the victim as soon as it is re-read, whether the killer
   * was or not. Distinct from `vx`/`vy`, which exist ONLY to ORIENT the effect and
   * therefore require the complete pair (89/93 rule) — the heat map of the eliminations,
   * for its part, does not need the killer to know where one died. POC measurement: out of 93
   * deaths, the complete pair covers 89 and the « victim alone » ones 3 more, which this field
   * recovers. null = victim not located: no position guessed.
   */
  deathX: number | null
  deathY: number | null
  /** Killer-victim distance in world meters (null without a complete pair). */
  dist: number | null
  fam: ShotFamily
  /** Slot of the killer's life at this instant (for its color); null if not found. */
  slot: number | null
  /** Stable seed: two readings of the same instant give back the same shape. */
  seed: number
}

/** slotOfPlayerAt — the slot of the player's life covering the frame (or the last closed one). */
function slotOfPlayerAt(
  lives: ReplayTrackReady[] | undefined,
  frame: number,
  deathFrames: number,
): number | null {
  if (!lives) return null
  for (const l of lives) {
    if (isAliveAt(l, frame)) return l.slot
  }
  for (const l of lives) {
    const d = frame - trackWindow(l).end
    if (d >= 0 && d <= deathFrames) return l.slot
  }
  return null
}

/**
 * buildKillFx precomputes the death effects of a document: world positions resolved once
 * at load time (POC pattern — 93 deaths, no lookup during playback).
 *
 * THE CLOCK ARRIVES ALREADY DONE (2026-09-05, J2): the kills received are those of the FEED, aligned
 * once only by the page (`buildFeedEntries` -> `killsOfFeed`). This module no longer replays
 * the alignment — one single rule for the feed and the map, and one single execution. It is this
 * alignment that makes the DEATH window effective — witness measurement 000d5950: 1/93 victims
 * re-read with the raw alignment `+t0`, 90/93 once aligned.
 */
export function buildKillFx(
  doc: ReplayDocumentReady,
  kills: readonly ReplayKill[],
  seatedOfXuid?: (xuid: string, frame: number) => boolean,
): KillFxEntry[] {
  if (kills.length === 0 || doc.tracks.length === 0) return []
  // THE POSITIONS GO THROUGH THE CARRIER RESOLVER (carrierPosition.ts, 2026-09-05): a
  // player killed AT THE WHEEL — or as a passenger — explodes where his vehicle rolls, not on the straight line
  // that his biped's track interpolated while he no longer replicated. The post-death
  // window of the fallback stays that of the victim, who has just died by construction.
  const posOf = buildCarrierPosAt(doc)
  // THE INDEX OF LIVES NO LONGER SERVES EXCEPT FOR THE SLOT (the color of the effect): the slot is a
  // property of THE BIPED'S LIFE, which no vehicle moves. Index and window come from
  // livesPosition.ts — no more local copy since the primitive was repatriated there.
  const lives = buildLivesByXuid(doc.tracks)
  const deathFrames = deathWindowFrames(doc)
  const out: KillFxEntry[] = []
  for (const k of kills) {
    const frame = Math.round(msToFrames(k.replayMs, doc))
    // THE PIECE RULE: a killer who no longer holds a card (a raised bot) has no position on
    // screen — the stroke does not start from a piece that no longer exists. The kill stays in the feed and in the
    // counts, and the death of his victim is always placed (non-oriented marker).
    const killer = seatedOfXuid && !seatedOfXuid(k.xuid, frame) ? null : posOf(k.xuid, frame)
    const victim = k.victimXuid ? posOf(k.victimXuid, frame) : null
    const origin = killer ?? victim
    if (!origin) continue // neither killer nor victim locatable: nothing is drawn
    const complete = killer !== null && victim !== null
    out.push({
      frame,
      x: origin.x,
      y: origin.y,
      vx: complete ? victim.x : null,
      vy: complete ? victim.y : null,
      deathX: victim ? victim.x : null,
      deathY: victim ? victim.y : null,
      dist: complete ? Math.hypot(victim.x - killer.x, victim.y - killer.y) : null,
      fam: familyOf(k.weaponKey ? doc.killEffects?.[k.weaponKey] : undefined),
      slot: slotOfPlayerAt(lives.get(k.xuid), frame, deathFrames),
      seed: (frame * 2654435761) % 100003,
    })
  }
  return out
}
