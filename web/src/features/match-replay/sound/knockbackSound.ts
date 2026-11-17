// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * knockbackSound.ts — THE REPELLER'S PUSH, heard every time the film writes it.
 *
 * THE SOURCE is the document (schema 94): `knockbacks`, one entry per pushed player, dated by the
 * pair of messages of the film (`EquipmentObjectKnockedBack` then `EquipmentKnockbackPlayer`). The sound
 * is THAT OF THE ALREADY DELIVERED REPELLER (`repulsor_kill`, its three variants): decision of
 * the user, "the repulsor is already good" — no new sound.
 *
 * TWO DEDUPLICATIONS, and they decide no fact (the push is published, we only choose
 * how many times to make it heard):
 *  - ONE BLAST, ONE SOUND. A same use often pushes several players, written in
 *    neighbor packets: the pushes of a same author within `KNOCKBACK_SAME_BLAST_MS` of the previous one
 *    do not replay the sound.
 *  - THE KILL ALREADY SOUNDS. A push that kills makes the repulsor kill sound heard
 *    (`KILL_SPRITE_SOUND_STEMS`, thumbnail `killfeed-56`) at the same moment: the push stays silent when
 *    a repulsor kill OF THE SAME AUTHOR (the killer is the author of the push, by his xuid) is
 *    scheduled within `KNOCKBACK_KILL_DEDUP_MS`. A push whose author is not named does
 *    not stay silent: we do not attach it to the kill of another.
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { frameToMs } from '../../../lib/replay/replayLogic'
import { buildLivesBySlot, lifeOfSlotAt, soundPositionOfSlot } from '../model/livesPosition'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'

/** The stem of the push: that of the repulsor kill, already delivered. */
export const KNOCKBACK_SOUND_STEM = 'repulsor_kill'

/** Window of a same blast, per author: one use, one sound. */
export const KNOCKBACK_SAME_BLAST_MS = 300

/** Gap below which a scheduled repulsor kill already covers the push. One and a half frames. */
export const KNOCKBACK_KILL_DEDUP_MS = 150

/** A repulsor kill already scheduled on the track: its moment and its killer. */
export interface RepulsorKillSound {
  ms: number
  xuid: string
}

/**
 * knockbackSoundEvents — one sound per published blast, except when the repulsor kill of the same author and
 * of the same moment already makes it heard. `repulsorKills` are the repulsor kills ALREADY scheduled
 * (the weapons category cut, there is none, and the push sounds alone).
 */
/**
 * knockbackSoundEvents — one sound per published blast, except when the repulsor kill of the same author and
 * of the same moment already makes it heard. `repulsorKills` are the repulsor kills ALREADY scheduled
 * (the weapons category cut, there is none, and the push sounds alone).
 *
 * POSITIONED AT THE PUSHER (`soundPositionOfSlot`): the blast comes from the repeller's barrel,
 * not from the pushed player. Falls back to the pushed player's own slot when the film does not
 * name the author (`coverage.knockbacks.withoutAuthor`) — a position is still better than none.
 */
export function knockbackSoundEvents(
  doc: ReplayDocumentReady,
  repulsorKills: readonly RepulsorKillSound[],
  followed: string | null = null,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  const lastByAuthor = new Map<string, number>()
  const lives = buildLivesBySlot(doc.tracks)
  const ordered = [...doc.knockbacks].sort((a, b) => a.t - b.t)
  for (const k of ordered) {
    const ms = frameToMs(k.t, doc)
    const author = k.by != null ? `by:${k.by}` : `pousse:${k.slot}`
    const last = lastByAuthor.get(author)
    if (last !== undefined && ms - last < KNOCKBACK_SAME_BLAST_MS) continue
    lastByAuthor.set(author, ms)
    const xuid = k.by != null ? lifeOfSlotAt(lives, k.by, k.t)?.xuid : undefined
    const couverte =
      !!xuid &&
      repulsorKills.some((e) => e.xuid === xuid && Math.abs(e.ms - ms) <= KNOCKBACK_KILL_DEDUP_MS)
    if (!couverte) {
      const at = soundPositionOfSlot(lives, k.by ?? k.slot, k.t, followed)
      out.push(soundEvent(ms, KNOCKBACK_SOUND_STEM, at))
    }
  }
  return out
}
