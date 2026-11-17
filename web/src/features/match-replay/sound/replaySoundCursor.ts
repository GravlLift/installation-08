// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replaySoundCursor.ts — READING THE TRACK: when an event goes out, and when it does not.
 * Nothing that SOUNDS lives here (the manifest and the track are in replaySound.ts) — only
 * the accounting of the cursor.
 *
 * EXTRACTED FROM `replaySound.ts` ON 2026-08-18 (lot R2-G) to pay for adding the end-of-flight
 * explosions: the original file announced three topics ("what sounds, when, and how the cursor
 * never replays anything twice") and was reaching the 500-line ceiling. The third is the only
 * one that never touches the manifest: it knows of the track only its moment and its order.
 *
 * THE RULE THIS FILE HOLDS, AND IT IS THE ONLY ONE: an event goes out ONCE, and a JUMP
 * (scrub, rewind, resume after pause) does not replay what it crossed.
 *
 * No React, no Web Audio: pure logic, tested (replaySound.test.ts).
 */
import type { ReplaySoundEvent } from './replaySound'

/**
 * Jump beyond which a forward move is NOT continuous playback but a jump
 * (scrub, return to the start, resume after a long pause): the cursor is RESEEDED without playing
 * anything — replaying in one go all the sounds crossed would make a wall of noise. At 4x, an
 * animation step advances by ~70 ms of replay: a 1 s margin cannot confuse the two.
 */
export const SOUND_RESYNC_JUMP_MS = 1_000

/**
 * Playback speed beyond which sound is MUTED.
 *
 * WHY. A sound holds ~1 s of real time whatever the speed: at 4x, that second covers 4 s of
 * match, and the kills of the same exchange (2 to 4 s apart) overlap continuously. What would
 * be heard then is no longer the rhythm of the match but that of the player. At 2x, they stay
 * distinct — that is the bound.
 */
export const SOUND_MAX_SPEED = 2

/** soundPlaysAtSpeed — does the sound make sense at this playback speed? */
export function soundPlaysAtSpeed(multiplier: number): boolean {
  return multiplier <= SOUND_MAX_SPEED
}

/**
 * The sound playback cursor: last moment SERVED (`ms`, which runs ahead of the playback when the
 * page schedules ahead), index of the next event, and the playback moment of the last beat
 * (`at`; absent = `ms`, a cursor that never ran ahead).
 */
export interface SoundCursor {
  ms: number
  idx: number
  at?: number
}

/** resyncSoundCursor sets the cursor AT the given moment: nothing before it will play. */
export function resyncSoundCursor(timeline: readonly ReplaySoundEvent[], ms: number): SoundCursor {
  // First index strictly after `ms` (binary search, timeline sorted).
  let lo = 0
  let hi = timeline.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (timeline[mid].ms <= ms) lo = mid + 1
    else hi = mid
  }
  return { ms, idx: lo, at: ms }
}

/**
 * advanceSoundCursor advances the cursor to `nowMs` and returns the events to play.
 *
 * Continuous playback (short advance): every event in (cursor.ms, nowMs + aheadMs] goes out ONCE
 * — `aheadMs` is the stretch of the track the page schedules AHEAD of the playback (lookahead,
 * `SOUND_LOOKAHEAD_S`), 0 for a cursor that plays what it crosses. Backward move or long jump of
 * the PLAYBACK (not of the served moment): silent reseeding, `jumped` — the sound follows the
 * playback, it does not narrate what was crossed.
 */
export function advanceSoundCursor(
  timeline: readonly ReplaySoundEvent[],
  cursor: SoundCursor,
  nowMs: number,
  aheadMs = 0,
): { cursor: SoundCursor; fire: ReplaySoundEvent[]; jumped: boolean } {
  const at = cursor.at ?? cursor.ms
  if (nowMs < at || nowMs - at > SOUND_RESYNC_JUMP_MS) {
    return { cursor: resyncSoundCursor(timeline, nowMs), fire: [], jumped: true }
  }
  const served = Math.max(cursor.ms, nowMs + Math.max(0, aheadMs))
  const fire: ReplaySoundEvent[] = []
  let idx = cursor.idx
  while (idx < timeline.length && timeline[idx].ms <= served) {
    fire.push(timeline[idx])
    idx++
  }
  return { cursor: { ms: served, idx, at: nowMs }, fire, jumped: false }
}
