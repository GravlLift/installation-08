/**
 * vehicleDestructionSound.ts — THE SOUND OF THE DESTRUCTION OF A VEHICLE (lot of 2026-09-05).
 *
 * THE SIGNAL IS EXACTLY THAT OF THE VISUAL EFFECT (schema 39, `vehiclesLayer.ts`): a
 * vehicle whose `end === VEHICLE_END_DESTROYED` AND whose `tEnd` is published — the two
 * conditions, carried by `vehicleDestructionFrame`, the SAME function as the explosion of
 * the layer (`vehiclesPaint.ts`). Until the Go publishes only `end: "unknown"` (the current
 * state of EVERY existing artifact), this chain returns ZERO events: the sound is READY, it
 * does not invent the measurement — exactly like the visual effect it accompanies.
 *
 * IT IS A SOUND EFFECT LIKE THE OTHERS: a one-shot placed in `buildSoundTimeline` (category
 * `weapon` of the drawer — same choice as the coils: an explosion of the world, and the drawer
 * has no "decor" checkbox), family `sfx` at the export, normal voice ceiling of the player. NOTHING
 * to do with the engine bus (0.85) of the continuous loops (`vehicleEngineSound.ts`): the
 * destruction is an event, not a state.
 *
 * THE BANKS ARE DEDUPLICATED, AND THAT IS A MEASUREMENT (md5 on the sources, 2026-09-05):
 * in `sons_v3_reconstruits/<Vehicle>/destruction/`, the files of the Wasp are IDENTICAL
 * byte for byte to those of the Warthog_roquettes, and those of the Wraith to those of the Banshee.
 * Delivering eight folders would have duplicated four banks: the files are therefore named by
 * SOUND SET (`vehicle_boom_<set>_<n>`), and the FAMILIES of the document (the same keys as
 * `VEHICLE_ENGINE_STEMS`) map onto them. Six distinct sets:
 *
 *   warthog         <- bank Warthog_roquettes (families warthog, wasp)
 *   covenant_lourd  <- bank Banshee           (families banshee, wraith)
 *   chopper         <- bank Chopper           (family chopper)
 *   ghost           <- bank Ghost             (family ghost)
 *   scorpion        <- bank Scorpion          (family scorpion)
 *   mongoose        <- bank Gungoose          (family mongoose — the Gungoose IS an
 *                      armed Mongoose, same chassis: written kinship, not an arbitrary borrowing,
 *                      same rule as the tracker that takes the sound of the sensor)
 *
 * THE THREE CLOSE TAKES of each bank (`explosion.ogg`, `_v2`, `_v3`) are the three
 * variants drawn at each destruction (`SOUND_VARIANTS`, same mechanics as the grapple);
 * the FAR TAKES (`explosion_lointaine_*`) are IGNORED — the replay has no notion
 * of camera distance. Delivered durations: 2.58 to 5.36 s, all WHOLE (none reaches the
 * safety ceiling of the player, 12 s — the truncation at the fade did not have to serve).
 * Equalization: -16 LUFS targeted, ceiling -1 dBTP, LINEAR gain only (convention of the lot R2-S).
 *
 * WHAT DOES NOT SOUND: the DECOR (pelican, phantom, skiff — `vehicleIsDecor`, the same
 * refusal as the layer and the engines: nothing destroys them in a match), an UNRESOLVED
 * FAMILY (empty string) or WITHOUT A SOUND SET — clean silence, never the bank of a neighbor.
 */
import type { ReplayVehicleTrackReady } from '../../../lib/replay/replayNormalize'
import { vehicleDestructionFrame, vehicleIsDecor } from '../model/vehiclesLayer'

/**
 * VEHICLE_BOOM_SETS — sound set -> its three variants, the first carrying the stem that the
 * family -> set join designates. It is a MANIFEST: the guardrail
 * `replaySoundAssets.guard.test.ts` replays it against the assets folder.
 */
export const VEHICLE_BOOM_SETS: Readonly<Record<string, readonly string[]>> = {
  warthog: ['vehicle_boom_warthog_1', 'vehicle_boom_warthog_2', 'vehicle_boom_warthog_3'],
  covenant_lourd: [
    'vehicle_boom_covenant_lourd_1',
    'vehicle_boom_covenant_lourd_2',
    'vehicle_boom_covenant_lourd_3',
  ],
  chopper: ['vehicle_boom_chopper_1', 'vehicle_boom_chopper_2', 'vehicle_boom_chopper_3'],
  ghost: ['vehicle_boom_ghost_1', 'vehicle_boom_ghost_2', 'vehicle_boom_ghost_3'],
  scorpion: ['vehicle_boom_scorpion_1', 'vehicle_boom_scorpion_2', 'vehicle_boom_scorpion_3'],
  mongoose: ['vehicle_boom_mongoose_1', 'vehicle_boom_mongoose_2', 'vehicle_boom_mongoose_3'],
}

/**
 * VEHICLE_BOOM_FAMILY_SET — family of the document (`VehicleTrack.family`, the same keys as
 * `VEHICLE_ENGINE_STEMS`) -> sound set. The measured bank duplicates are read here:
 * wasp shares the bank of the warthog, wraith that of the banshee. An absent family = silence.
 */
export const VEHICLE_BOOM_FAMILY_SET: Readonly<Record<string, string>> = {
  warthog: 'warthog',
  wasp: 'warthog',
  banshee: 'covenant_lourd',
  wraith: 'covenant_lourd',
  chopper: 'chopper',
  ghost: 'ghost',
  scorpion: 'scorpion',
  mongoose: 'mongoose',
}

/**
 * VEHICLE_BOOM_SOUND_VARIANTS — first stem of each set -> its three variants, merged
 * into `SOUND_VARIANTS` (replaySoundVariants.ts) so that `soundEvent` attaches them and
 * `pickVariantStem` draws at each destruction — the same mechanics as the vehicle shots,
 * and the same direction of dependency (this module does NOT import replaySoundVariants: no cycle).
 */
export const VEHICLE_BOOM_SOUND_VARIANTS: Readonly<Record<string, readonly string[]>> =
  Object.fromEntries(Object.values(VEHICLE_BOOM_SETS).map((stems) => [stems[0], stems]))

/** All the destruction stems — preloading and assets guardrail. */
export function allVehicleBoomStems(): string[] {
  return Object.values(VEHICLE_BOOM_SETS).flat()
}

/**
 * vehicleDestructionSound — the destruction of ONE vehicle: the frame of the proof and the stem
 * of the first variant, or `null` (destruction not established, decor, family without set).
 * `buildSoundTimeline` does the rest (dating `frameToMs`, attaching of the variants).
 */
export function vehicleDestructionSound(
  track: ReplayVehicleTrackReady,
): { frame: number; stem: string } | null {
  const frame = vehicleDestructionFrame(track)
  if (frame === null || !track.family || vehicleIsDecor(track.family)) return null
  const set = VEHICLE_BOOM_FAMILY_SET[track.family]
  const stems = set ? VEHICLE_BOOM_SETS[set] : undefined
  const stem = stems?.[0]
  return stem ? { frame, stem } : null
}
