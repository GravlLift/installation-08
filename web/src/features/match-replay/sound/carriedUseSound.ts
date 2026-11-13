/**
 * carriedUseSound.ts — USING A CARRIED PIECE OF EQUIPMENT, heard at the moment the film dates it.
 *
 * THE SOURCE is the document (schema 95): `carriedEquipment[].uses`, the frames of the carried
 * item's activations (i21). Each one is followed, one or two frames later, by the energy drop of a
 * cost of the family: that is the gesture consuming a charge. The family is the one from the item's
 * rank (`abilityLabels[r].family`).
 *
 * WHY THESE FOUR FAMILIES, AND WHY NOT THEIR PLACEMENT. The sensor, the threat seeker, the repair
 * field and the shroud screen used to sound on their `deployed` placement (`equipmentPlacements`);
 * the film no longer produces a `deployed` placement for them since the 15/09 rule, and they had
 * been silent since. Their use is dated by the film: user decision of 2026-10-15, rewire them on
 * it, with the same stem and the same variants as before. The wall keeps its `deployed`
 * placement, which follows its use by two or three frames: it does not enter here, otherwise it
 * would sound twice.
 *
 * THE MOMENT is the use as read, no offset: none of these four sounds has a rise noted
 * (unlike the rift's placement, `riftPoseSound.ts`). Equipment category.
 *
 * THE END OF THE REPAIR FIELD (user decision of 2026-10-15: "if we have the event, we
 * rewire the end sound"). The film writes it: the carried item's i28 stack names the object the
 * equipment spawns, and the DELETION of that object is the end of the field
 * (`carriedEquipment[].tracked[].t1`). The deactivation sound (`play_007_abl_repairfield_deactivate`)
 * goes out on that frame; a field whose deletion is not read does not sound its end.
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { frameToMs } from '../../../lib/replay/replayLogic'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'

/** The use stem, per palette family. */
export const CARRIED_USE_SOUND_STEMS: Readonly<Record<string, string>> = {
  sensor: 'sensor_activate',
  // Same device as the sensor, one mode over: same gesture, so same sound.
  threat_seeker: 'sensor_activate',
  // The field's ACTIVATION (`play_007_abl_repairfield_activate`), not the clatter of its placement:
  // user decision of 2026-08-27, details in `replaySound.ts`.
  repair_field: 'repair_field_activate',
  // `play_007_abl_shroud_deploy_player`, bank `sb_007_abl_shroud` (named 2026-08-27).
  shroud_screen: 'shroud_deploy',
}

/** carriedUseSoundEvents — one sound per published use of a family in the table, on its frame. */
export function carriedUseSoundEvents(doc: ReplayDocumentReady): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  for (const c of doc.carriedEquipment) {
    const family = doc.abilityLabels?.[String(c.r)]?.family
    const stem = family ? CARRIED_USE_SOUND_STEMS[family] : undefined
    if (!stem) continue
    for (const u of c.uses) out.push(soundEvent(frameToMs(u, doc), stem))
  }
  return out
}

/**
 * The stem of the END of a spawned object, per family: only the repair field has a
 * proper deactivation sound in the game (product decision of 2026-08-26, "including the
 * disappearing repair field").
 */
export const CARRIED_END_SOUND_STEMS: Readonly<Record<string, string>> = {
  repair_field: 'repair_field_end',
}

/** carriedEndSoundEvents — one sound per end read of a spawned object of a family in the table. */
export function carriedEndSoundEvents(doc: ReplayDocumentReady): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  for (const c of doc.carriedEquipment) {
    const family = doc.abilityLabels?.[String(c.r)]?.family
    const stem = family ? CARRIED_END_SOUND_STEMS[family] : undefined
    if (!stem) continue
    for (const s of c.tracked) if (s.t1 !== undefined) out.push(soundEvent(frameToMs(s.t1, doc), stem))
  }
  return out
}
