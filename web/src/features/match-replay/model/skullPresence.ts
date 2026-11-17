// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * skullPresence.ts — THE PRESENCE RULE OF Oddball's SKULL (schema 23), pure.
 *
 * WHY THIS MODULE. The free skull (`objectiveObjects`) and the carried skull (`skullCarries`)
 * are TWO disjoint layers: the first publishes positions actually emitted, the second carrying
 * intervals. Between the two remain REST HOLES — the skull sits on its pedestal and emits only
 * a SINGLE INSTANT (one life where t0 == t1, one point). The primitive `objectiveObjectAt`
 * only replicates inside [t0, t1]: a pedestal life then blinks for one frame and vanishes,
 * and the skull becomes invisible at rest (a third of the film as measured).
 *
 * This module composes the two layers into a SINGLE PRESENCE per frame, never drawing in two
 * places (unique presence + carrying precedence). It knows neither React, nor the DOM, nor
 * the color, nor the slightest label: the ink and the strokes are resolved by the caller.
 *
 * THE RULE IS THE TEST OF THE NEXT EVENT, and it is the ONLY correct one (a naive formula
 * "hold until the next pickup" would park the skull at the drop-into-the-void point during
 * the respawn cooldown). A rest is held only if a PICKUP corroborates it: the carrier arrives
 * ON the held position. A rest followed by a LIFE (respawn on the pedestal, a drop that rolls)
 * does NOT hold the previous position — no ghost at the wrong place.
 *
 * BUT THE SKULL IS NEVER NOWHERE: when it is neither carried nor on the ground in play, it is
 * PARKED ON ITS PEDESTAL (its respawn point). Where the rule said `absent` (before its first
 * emission, during an out-of-zone respawn cooldown), it is placed on its pedestal when one
 * knows where it is — and one knows: `skullSocle` reads it as the MODE of the instant lives
 * (the skull respawns there in a loop, a drop into the void emits only a single isolated
 * instant there). Without an identifiable pedestal (artifact too short), it falls back on
 * `absent`.
 *
 * CARRYING PRECEDENCE IS CONDITIONED ON A POSITION OF THE CARRIER (audit of 2026-09-10,
 * causes C9/C10; lot 6.7 phase B2). The carrying is an INTERVAL, the biped's trajectory a
 * run of samples that can break off: on 694 frames of the Oddball park (7.0%, report
 * 6.2 section 2.1) the carrying is true but the carrier has NO position. Returning `carried`
 * on that basis used to silence this module while `skullCarrierLayer` drew nothing for lack
 * of a position — the skull DISAPPEARED. The rule common to the three carried glyphs
 * (`carriedGlyphPlace.ts`) now renders it FREE at its last known position: that of the
 * carrier, failing that the last rest, failing that the pedestal. One glyph on screen, never
 * zero, never two.
 *
 * DEGRADATION: with `carries: []` (artifacts prior to schema 23), no pickup ever follows a
 * rest -> the hold never triggers -> the presence falls back EXACTLY on the historical
 * behavior (active life only, silent elsewhere).
 */
import { objectiveObjectAt } from '../layers/objectiveObjectsLayer'

import { carriedGlyphPlaceAt, type CarrierPosAt } from './carriedGlyphPlace'
import type { XY } from '../../../lib/replay/replayLogic'
import type { ReplayObjectiveObjectReady, ReplaySkullCarry } from '../../../lib/replay/replayNormalize'
import { covers } from './replaySpans'

/** SkullPresence — what the skull shows at a given frame, in a single answer. */
export type SkullPresence =
  /** Someone carries it: the free layer falls silent, `skullCarrierLayer` draws it. */
  | { state: 'carried' }
  /** It is on the ground at `at`; `rolling` if it is still moving (a point follows in its life). */
  | { state: 'free'; at: XY; rolling: boolean }
  /** It has no honest position at this frame (pre-emission, respawn, fall-back). */
  | { state: 'absent' }

/**
 * skullPresenceAt applies the test of the next event to the frame served.
 *
 * 1. A CARRY covers F → `carried`, BUT ONLY IF ITS CARRIER HAS A POSITION AT THIS FRAME
 *    (cf. the header, conditioned precedence). Otherwise the skull is FREE at its last position
 *    known — that of the carrier, if not the last rest, if not the socle.
 * 2. Otherwise an ACTIVE LIFE covers F → `free` at the last point emitted (= `objectiveObjectAt`).
 * 3. Otherwise (REST HOLE): `lastRest` = the life with the largest `t1 <= F`. None → `absent`.
 *    Otherwise one looks at the NEXT beginning strictly > F (all lives AND carries):
 *      - a PICKUP (carry.t0) → `free` HELD at the last rest of `lastRest`, `rolling:false`;
 *      - a LIFE (life.t0), or none → `absent`.
 *    Tie life/carry at the same beginning: the LIFE wins (safe choice, avoids the ghost).
 */
export function skullPresenceAt(
  lives: readonly ReplayObjectiveObjectReady[],
  carries: readonly ReplaySkullCarry[],
  frame: number,
  socle: XY | null = null,
  posOf: CarrierPosAt | null = null,
): SkullPresence {
  for (const carry of carries) {
    if (!covers(carry, frame)) continue
    // WITHOUT A POSITION READER, the precedence of the carrying stays entire: it is the degradation
    // of the callers that do not re-read the trajectories (and the behavior before this lot).
    if (!posOf) return { state: 'carried' }
    const place = carriedGlyphPlaceAt(posOf, carry, frame, lastRestPointOf(lives, frame) ?? socle)
    if (place.state === 'carried') return { state: 'carried' }
    // The skull FREE at the last known point: it does not ROLL — this position is a rest
    // observed, not a sample of trajectory in progress.
    return place.state === 'free' ? { state: 'free', at: place.at, rolling: false } : { state: 'absent' }
  }
  for (const life of lives) {
    const now = objectiveObjectAt(life, frame)
    if (now) return { state: 'free', at: now.at, rolling: now.rolling }
  }
  const lastRest = lastRestOf(lives, frame)
  if (lastRest === null) return restOnSocle(socle)
  // Next beginning > F: the lives set the threshold, a carry wins only STRICTLY
  // earlier (a carry tied with a life does not take precedence — the life wins the tie).
  let nextStart = Infinity
  let nextIsCarry = false
  for (const life of lives) {
    if (life.t0 > frame && life.t0 < nextStart) {
      nextStart = life.t0
      nextIsCarry = false
    }
  }
  for (const carry of carries) {
    if (carry.t0 > frame && carry.t0 < nextStart) {
      nextStart = carry.t0
      nextIsCarry = true
    }
  }
  if (!nextIsCarry) return restOnSocle(socle)
  const p = lastRest.pts[lastRest.pts.length - 1]
  return { state: 'free', at: { x: p.x, y: p.y }, rolling: false }
}

/**
 * lastRestOf — the life with the largest `t1 <= frame` that has emitted at least one point, or `null`.
 * It is the LAST PLACE WHERE THE SKULL WAS SEEN on the ground before the frame served.
 */
function lastRestOf(
  lives: readonly ReplayObjectiveObjectReady[],
  frame: number,
): ReplayObjectiveObjectReady | null {
  let lastRest: ReplayObjectiveObjectReady | null = null
  for (const life of lives) {
    if (life.t1 <= frame && life.pts.length > 0 && (lastRest === null || life.t1 > lastRest.t1)) {
      lastRest = life
    }
  }
  return lastRest
}

/** The last point emitted of the last rest, or `null` — the position fallback of the object itself. */
function lastRestPointOf(
  lives: readonly ReplayObjectiveObjectReady[],
  frame: number,
): XY | null {
  const rest = lastRestOf(lives, frame)
  if (rest === null) return null
  const p = rest.pts[rest.pts.length - 1]
  return { x: p.x, y: p.y }
}

/**
 * restOnSocle — the skull at REST is on its SOCLE. When the presence is otherwise `absent`
 * (before its first emission, during an out-of-zone respawn cooldown), the skull has not
 * disappeared: it has retreated onto its socle. It is placed there IF the socle is known; otherwise, lacking
 * an honest position, `absent` (historical behavior, artifact without identifiable socle).
 */
function restOnSocle(socle: XY | null): SkullPresence {
  return socle ? { state: 'free', at: socle, rolling: false } : { state: 'absent' }
}

/**
 * skullSocle returns the position of the skull's PEDESTAL, or `null`. The pedestal is where
 * the skull REAPPEARS: its instant lives (t0 == t1, one point) repeat there, while a drop
 * into the void emits its instant only ONCE, elsewhere. The pedestal is therefore the MODE
 * of the instant-lives' positions, to the meter. A RECURRENCE (>= 2) is required: a single
 * isolated instant is more likely a drop than a pedestal. Computed ONCE per document
 * (the caller memoizes).
 */
export function skullSocle(lives: readonly ReplayObjectiveObjectReady[]): XY | null {
  const tally = new Map<string, { at: XY; n: number }>()
  for (const life of lives) {
    if (life.t0 !== life.t1 || life.pts.length === 0) continue
    const p = life.pts[0]
    const key = `${Math.round(p.x)},${Math.round(p.y)}`
    const seen = tally.get(key)
    if (seen) seen.n += 1
    else tally.set(key, { at: { x: p.x, y: p.y }, n: 1 })
  }
  let best: { at: XY; n: number } | null = null
  for (const e of tally.values()) {
    if (best === null || e.n > best.n) best = e
  }
  return best && best.n >= 2 ? best.at : null
}
