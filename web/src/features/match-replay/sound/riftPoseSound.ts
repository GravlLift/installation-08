// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * riftPoseSound.ts — THE PLACEMENT OF THE TRANSPORTER'S RIFT, heard so that its HIT lands at the placement.
 *
 * THE SOURCE is the document (schema 95): `riftPoses`, one entry per placement, dated by the
 * film — the energy of the carried transporter falls to zero — with the activation that
 * precedes it (`a`, ~1.63 s earlier across the whole corpus).
 *
 * THE SOUND (`translocator_deploy`) is the gesture as the game plays it, reassembled in five
 * native layers of the device's bank (`sb_007_abl_quantum`) on the user's in-game recording:
 * charge `55f75682`, foley `9520fe71`, placement HIT `0431c88f`, foley `a9c26b1b`, loop of the
 * rift `388207de` (cut in a fade); 48 kHz, crest capped at -1 dBTP. The hit is at 1.045 s from
 * the start of the file: the sound goes out 1.045 s before the placement, never before the
 * activation that commanded it. Category Equipment.
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { frameToMs } from '../../../lib/replay/replayLogic'
import { buildLivesBySlot, lifeOfSlotAt } from '../model/livesPosition'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'

/** The stem of the rift placement. */
export const RIFT_POSE_SOUND_STEM = 'translocator_deploy'

/** Position of the placement HIT in the file, in milliseconds (measured on the in-game recording). */
export const RIFT_POSE_HIT_OFFSET_MS = 1045

/**
 * riftPoseSoundEvents — one sound per published placement, its hit at the moment of the
 * placement, at the rift's own position (x/y, when the film reads them) — the followed
 * player's own placement stays without a place.
 */
export function riftPoseSoundEvents(
  doc: ReplayDocumentReady,
  followed: string | null = null,
): ReplaySoundEvent[] {
  const lives = buildLivesBySlot(doc.tracks)
  return doc.riftPoses.map((p) => {
    let depart = frameToMs(p.t, doc) - RIFT_POSE_HIT_OFFSET_MS
    if (p.a !== undefined) depart = Math.max(depart, frameToMs(p.a, doc))
    const own = followed !== null && lifeOfSlotAt(lives, p.slot, p.t)?.xuid === followed
    const at = own || p.x === undefined || p.y === undefined ? undefined : { x: p.x, y: p.y }
    return soundEvent(Math.max(0, depart), RIFT_POSE_SOUND_STEM, at)
  })
}
