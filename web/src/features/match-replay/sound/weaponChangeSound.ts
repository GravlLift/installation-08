// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * weaponChangeSound.ts — THE PICKUP AND THE DROP OF WEAPON, dated by the film.
 *
 * ## Why this file can exist since 2026-08-30, and not before
 *
 * The old rule (`padSound.ts`, deleted the same day) played the pickup at the first SHOT
 * of a pad weapon family — correct measurements, wrong conclusion: the doctrine of this
 * chain is that the replay STAYS SILENT rather than guessing, and moving a sound to another gesture
 * is not staying silent. The pickup work site (schema 25) changed the game: `doc.weaponChanges`
 * PUBLISHES the pickups and the drops, dated to the frame, per life. There is nothing left to deduce —
 * we play what the layer dates, like everywhere else.
 *
 * ## The sounds, and where they come from
 *
 * The two gestures live in the sound bank of the Spartan (`sb_006_chm_un_spartan`,
 * `e9a52b26`) and carry the same Wwise signature: one layer, one variant out of three,
 * gain -6 dB.
 *
 *  - THE DROP: `play_006_chm_un_spartan_weapondrop` (`6cdd92fd`, 0.31 s) — the only event
 *    of these 230 whose name is broken, DESIGNATED by ear by the user on 2026-08-30.
 *  - THE PICKUP: `168832f6` (0.34 s) — name not broken, designated the same day BY DEFAULT
 *    ("for lack of better") among the eleven gestures of the bank that carry the signature of
 *    the drop. The designation is weaker than the others and the RE says it (§ 12.5); if the
 *    render sounds wrong in situation, the ten other candidates remain on the board
 *    `3c84fab7-5e36-4777-a2d9-bd1c90b08f65`.
 *
 * ## The rule, and its two written choices
 *
 *  - A `swapped` SOUNDS THE PICKUP, AND NOTHING ELSE. An exchange is a drop and a pickup
 *    at the same moment; playing the two files superimposed would make a mixing artifact, not
 *    two gestures. What is heard of an exchange is the weapon that ARRIVES in hand.
 *  - ALL THE LIVES SOUND, like the shots and the grenades: the layer publishes the author, the
 *    settings drawer filters by category, not by player. The measured order of magnitude of
 *    the channel is ~100-230 changes per match — that of the grenade throws.
 *
 * ## The NATIVE channel comes to FILL the holes, and above all not double (schema 30, 2026-08-31)
 *
 * `doc.pickups` publishes the event `biped_pickup` that the coil writes itself. Where the two
 * channels see the same pickup, they agree (21/21 and 11/12 pairings named weapon less than
 * 500 ms apart) — playing the two would make sound TWICE the same gesture. But `weaponChanges` has a
 * PARTIAL recall: on the reference film, the keyframes reveal seven weapon arrivals
 * it does not explain (Gravity Hammer x3, M41 SPNKr x3, Stalker Rifle x1), and the native channel
 * names five of them. Those pickups are today SILENT.
 *
 * The rule is therefore: a native WEAPON pickup sounds IF AND ONLY IF no `taken` /
 * `swapped` of `weaponChanges` covers it (same life, same family, less than five frames —
 * the 500 ms pairing tolerance on a 100 ms grid). That is exactly the doctrine
 * applied on the Go side to the equipment classes: fill a hole, never duplicate.
 *
 * NON-WEAPON PICKUPS DO NOT SOUND HERE. The native channel publishes them (classes 2 and 3: equipment,
 * grenades, consumables) but their sound is already the affair of `equipmentChangeSound`. Giving them
 * on top the sound of the weapon pickup would make hear a weapon where there is none.
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { frameToMs } from '../../../lib/replay/replayLogic'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import { buildLivesBySlot, soundPositionOfSlot } from '../model/livesPosition'

/**
 * The files, by gesture. The `swapped` has no entry: it plays `taken` (cf. the header).
 */
export const WEAPON_CHANGE_SOUND_STEMS = {
  /** The weapon arrives in hand — pickup, or audible half of an exchange. */
  taken: 'weapon_pickup',
  /** The slot goes empty: the weapon goes to the ground. */
  dropped: 'weapon_drop',
} as const

/**
 * weaponChangeSoundEvents — one sound per published weapon change, at its frame.
 *
 * No side and no filter: the gesture belongs to the one who does it, and the document
 * already excludes the spawn re-announcements (they are not pickups, cf.
 * document_weapon_changes.go on the Go side).
 *
 * POSITIONED AT THE HAND THAT DOES IT (`soundPositionOfSlot`): the followed player's own
 * pickup or drop stays without a place, every other life's carries its map position.
 */
export function weaponChangeSoundEvents(
  doc: ReplayDocumentReady,
  followed: string | null = null,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  const lives = buildLivesBySlot(doc.tracks)
  for (const c of doc.weaponChanges) {
    const stem =
      c.kind === 'dropped' ? WEAPON_CHANGE_SOUND_STEMS.dropped : WEAPON_CHANGE_SOUND_STEMS.taken
    out.push(soundEvent(frameToMs(c.t, doc), stem, soundPositionOfSlot(lives, c.slot, c.t, followed)))
  }
  for (const p of nativePickupsNotAlreadyHeard(doc)) {
    out.push(soundEvent(frameToMs(p.t, doc), WEAPON_CHANGE_SOUND_STEMS.taken, soundPositionOfSlot(lives, p.slot, p.t, followed)))
  }
  return out
}

/**
 * NATIVE_PICKUP_MATCH_FRAMES — the window that decides that a native pickup and a `taken` of
 * `weaponChanges` are THE SAME gesture. Five frames = 500 ms on the 100 ms grid of the replay,
 * that is, the tolerance under which the agreement of the two channels was measured on the Go side.
 *
 * NOT EXPORTED: nothing outside this module has to know the window. The first version
 * exported it "just in case" — no one imported it, and `knip` would have flagged it.
 */
const NATIVE_PICKUP_MATCH_FRAMES = 5

/**
 * nativePickupsNotAlreadyHeard — the native WEAPON pickups that `weaponChanges` does not cover.
 * It is the only population that has the right to sound on top: everything else would
 * make hear twice the same gesture (cf. the header). Not exported, for the same reason: its
 * only consumer is `weaponChangeSoundEvents`, and the tests go through it.
 */
function nativePickupsNotAlreadyHeard(
  doc: ReplayDocumentReady,
): ReplayDocumentReady['pickups'] {
  // Optional by design: an artifact prior to schema 30 has no `pickups`, and the
  // replay must stay silent on what it does not carry, not throw.
  if (!doc.pickups?.length) return []
  const heard = doc.weaponChanges.filter((c) => c.kind !== 'dropped')
  return doc.pickups.filter((p) => {
    if (p.kind !== 'weapon') return false
    return !heard.some(
      (c) =>
        c.slot === p.slot &&
        c.w === p.w &&
        Math.abs(c.t - p.t) <= NATIVE_PICKUP_MATCH_FRAMES,
    )
  })
}
