// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * abilityImpulseSound.ts — USING AN ABILITY THAT PROPULSES ITS CASTER, dated by the film.
 *
 * THE SOURCE is the document (schema 38): `abilityImpulses`, a FLAT entry per gesture —
 * (t, slot, family) — read in the `tag == 1` body of the i57/i59 components (the same channel
 * whose tag 3 carries the grapple) and ATTRIBUTED by the ability rank of the SAME LIFE. No speed
 * threshold, no heuristic: the app plays what the layer dates.
 *
 * THE VALIDATION IS A GROUND TRUTH, not an internal measurement: on film `1cd3848a`,
 * the user logged his five thruster uses in the Theater (1:51, 1:54, 2:03, 2:05,
 * 2:14) and the chain returns 1:52, 1:55, 2:03, 2:05, 2:15 — precision 5/5, recall 5/5.
 *
 * ## Why a TABLE PER FAMILY and not a single stem
 *
 * The grapple sounds through a bare stem (`GRAPPLE_SOUND_STEM`) because its layer carries ONLY
 * pulls. This one carries a `family`: it is open to any ability the title will declare
 * measured. A family absent from the table stays SILENT — never the sound of a
 * neighbor, same rule as `EQUIPMENT_PLACEMENT_SOUND_STEMS`.
 *
 * THE REPELLER WILL NOT ENTER THROUGH THIS CHANNEL: it is not in the ability impulses
 * (negative measured on nine channels, lots R8/R9 of 2026-09-03). The film dates its PULSES by a
 * pair of messages (schema 94, `doc.knockbacks`): they sound through `knockbackSound.ts`.
 *
 * EQUIPMENT CATEGORY — the thruster is a player equipment ability, same as
 * the grapple, the cloak and the shield boost (cf. `buildSoundTimeline`).
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { frameToMs } from '../../../lib/replay/replayLogic'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import { buildLivesBySlot, soundPositionOfSlot } from '../model/livesPosition'

/**
 * The impulse stems, PER FAMILY of the document.
 *
 * `thruster`: bank `sb_007_abl_evade`, event `307114b6` =
 * `play_007_abl_evade_blast_player` — name broken by templates against a dictionary of
 * 138 886 tokens (expected collision 0.00091, threshold 0.10), and re-closed by the
 * complementary `_player` / `_nonplayer` pair on the same radical.
 * Three variants: the game draws one per dash (`replaySoundVariants.ts`).
 *
 * POSITIONED AT THE CASTER (`soundPositionOfSlot`, owner directive of 2026-11-16: every sound
 * tied to a player must fall off with distance). The followed player's own dash is heard "from
 * inside" — no place — and every other caster's carries its map position. Until then this
 * played at the caster's perspective UNSPATIALIZED FOR EVERYONE, a staging choice from the
 * ability's first delivery that predates the distance-dependence requirement.
 */
export const ABILITY_IMPULSE_SOUND_STEMS: Readonly<Record<string, string>> = {
  thruster: 'thruster_activate',
}

/**
 * abilityImpulseSoundEvents — one sound per published impulse whose family has a stem, at the
 * caster's position (absent for the followed player's own cast).
 */
export function abilityImpulseSoundEvents(
  doc: ReplayDocumentReady,
  followed: string | null = null,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  const lives = buildLivesBySlot(doc.tracks)
  for (const imp of doc.abilityImpulses) {
    const stem = ABILITY_IMPULSE_SOUND_STEMS[imp.family]
    if (!stem) continue
    out.push(soundEvent(frameToMs(imp.t, doc), stem, soundPositionOfSlot(lives, imp.slot, imp.t, followed)))
  }
  return out
}
