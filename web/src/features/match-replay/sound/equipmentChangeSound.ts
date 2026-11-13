/**
 * equipmentChangeSound.ts — PICKING UP EQUIPMENT, dated by the film.
 *
 * The sound has been identified since 2026-08-26 and confirmed by ear by the user
 * ("that's right for picking up weapons on power-up stands"):
 * `play_007_abl_shared_pickup` (`c73036e4`, bank `sb_007_abl_shared`, 0.80 s). What
 * was missing was the MOMENT — and schema 26 publishes it: `doc.equipmentChanges` carries
 * pickups (`taken`) and consumptions (`spent`), dated to the frame, per life. Nothing to
 * infer: the app plays what the layer dates.
 *
 * ## `spent` is SILENT, and that is a written choice
 *
 * Consuming a piece of equipment is USING it — and the use already sounds through its own
 * family: the cloak and the shield boost through their episodes (`equipmentEpisodes`), the wall
 * through its placement (`equipmentPlacements`), the sensor, the threat seeker, the repair field and
 * the shroud screen through their use (`carriedEquipment[].uses`), the grapple through its pull
 * (`grappleLines`), the repeller through its kill. A generic "consumption" jingle
 * would DOUBLE those very sounds at the same moment. Families whose use has not been measured yet
 * stay silent — same rule as everywhere: we do not guess.
 *
 * `spent` served as a card shred for the TRANSPORTER from 2026-09-02 to 2026-09-03; it is no
 * longer, since schema 38, but the FALLBACK for old artifacts — the use is dated by
 * the film event (`translocations[]`, cf. `placementTeleport.ts`). In both cases it is
 * a VISUAL effect, not a sound: the silence of this file only concerns audio, and it holds —
 * no stem is designated for translocation (same rule as the skull).
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { frameToMs } from '../../../lib/replay/replayLogic'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'

/**
 * The equipment pickup sound. Bank `sb_007_abl_shared`, event `c73036e4` =
 * `play_007_abl_shared_pickup` — name broken by hashing AND confirmed by ear.
 */
export const EQUIPMENT_PICKUP_SOUND_STEM = 'objective_pad_pickup'

/** equipmentChangeSoundEvents — one sound per published pickup, on its frame. */
export function equipmentChangeSoundEvents(doc: ReplayDocumentReady): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  for (const c of doc.equipmentChanges) {
    if (c.kind !== 'taken') continue
    out.push(soundEvent(frameToMs(c.t, doc), EQUIPMENT_PICKUP_SOUND_STEM))
  }
  return out
}
