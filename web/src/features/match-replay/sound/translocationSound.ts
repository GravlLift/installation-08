/**
 * translocationSound.ts — THE TELEPORTATION OF THE TRANSPORTER, heard at its departure.
 *
 * THE SOURCE is the document (schema 38): `translocations`, one entry per jump, dated by the
 * film event `EquipmentTranslocatorTeleportEffects` (type 117), which precedes the jump by 5 to
 * 80 ms. The sound goes out at that moment: it is the DEPARTURE of the gesture.
 *
 * THE SOUND (`translocator_teleport`) is the gesture as the game plays it, reassembled from the
 * device's bank (`sb_007_abl_quantum`): the departure event of the carrier `10f62776`
 * (`play_007_abl_quantum_teleport_player_start`, `.wem` 123675313) then, 0.20 s later, the
 * effect `efe84c70` (`.wem` 596614165), delays and gains measured on a game capture; 48 kHz
 * stereo, crest capped at -1 dBTP. Category Equipment.
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { frameToMs } from '../../../lib/replay/replayLogic'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'

/** The stem of the teleportation. */
export const TRANSLOCATION_SOUND_STEM = 'translocator_teleport'

/** translocationSoundEvents — one sound per published teleportation, at its frame. */
export function translocationSoundEvents(doc: ReplayDocumentReady): ReplaySoundEvent[] {
  return doc.translocations.map((t) => soundEvent(frameToMs(t.t, doc), TRANSLOCATION_SOUND_STEM))
}
