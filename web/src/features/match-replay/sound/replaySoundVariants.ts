/**
 * replaySoundVariants.ts — ONE GESTURE, SEVERAL FILES: the drawing of a variant.
 *
 * EXTRACTED FROM `replaySound.ts` ON 2026-08-26, for the same reason as `replaySoundCursor.ts`
 * and `grenadeSound.ts` before it: the original file was reaching its readability ceiling.
 * What lives here is everything that concerns the CHOICE of the file — the event type, the
 * manifest of variants, the constructor that attaches them, and the drawing itself.
 *
 * WHY VARIANTS. A Wwise event whose layer is a `RandomSequence` does not play a file: it
 * DRAWS one, uniformly (measurement of the weapons work site: 6,976 tables of equal weights out
 * of 6,976). Delivering a single variant was therefore publishing an impoverished gesture —
 * three placements of repair field in the same match sounded exactly the same, where the game
 * plays three different ones.
 *
 * THE DRAWING HAPPENS AT PLAYBACK, NEVER AT THE CONSTRUCTION OF THE TRACK. A track is built
 * once for the whole match (`buildSoundTimeline`, memoized): drawing in it would freeze the
 * choice, and two occurrences of the same gesture would replay the same file — exactly what the
 * variant is meant to avoid.
 */

import { VEHICLE_BOOM_SOUND_VARIANTS } from './vehicleDestructionSound'
import { VEHICLE_SHOT_SOUND_VARIANTS } from './vehicleShotSound'

/** A sound event placed on the replay clock. */
export interface ReplaySoundEvent {
  /** Moment in ms on the replay clock (that of the thread and the cards). */
  ms: number
  /**
   * Stem of the file under static/sounds/{titleSlug}/ — the FIRST variant when there are
   * several, and the file played when `variants` is absent.
   */
  stem: string
  /** All the playable variants of this gesture, `stem` included. Absent = a single file. */
  variants?: readonly string[]
  /**
   * THE HELD SOUND of a continuous fire burst (schema 71): the file plays IN A LOOP during
   * `holdMs`, then fades out (`SOUND_HOLD_RELEASE_S`). Absent = a point sound.
   */
  holdMs?: number
  /**
   * THE SHOT CUT TO THE RATE: a shot of a burst without loop stops at the next shot, like the
   * game's container in "trigger rate" mode — one voice per burst, never a wall.
   */
  cutMs?: number
  /**
   * AN ANNOUNCER VOICE ("round ended"): it escapes the voice ceiling, at the page as at the
   * export (`soundOccupiesVoice`). Absent = a sound effect, subject to the ceiling.
   */
  announcer?: true
  /**
   * A LEVEL GAIN of this event, in dB, added to the playback's draw at the page as at the export
   * (`withEventGain`). Absent = the file's level. Only the reloads carry one (`reloadLoudness.ts`).
   */
  gainDb?: number
  /**
   * Where the sound comes from, in map coordinates (x, y): the horizontal plane of spatial
   * sound (`soundSpatial.ts`). Absent = a sound without a place, played as is whatever the
   * listener.
   */
  at?: { x: number; y: number }
}

/**
 * SOUND_VARIANTS — the gestures that the game plays by DRAWING a variant, and the EXACT list
 * of their files. It is a MANIFEST just like the tables of `replaySound.ts`: the guardrail
 * `replaySoundAssets.guard.test.ts` replays it against the assets folder, a stem without a file
 * or a file without a stem breaks the test.
 *
 * THE FIRST VARIANT KEEPS THE BARE STEM, and that is not vanity: the existing tables and
 * guardrails already name `grapple_fire`, `repulsor_kill`, `repair_field_activate`. Suffixing
 * the three would have made a cascade renaming without giving anything to the ear.
 *
 * SCOPE: only the gestures of which the render of 2026-08-26 produced several variants enter.
 * A stem absent from this table plays as is — that is the case of all the others, including
 * the seven objective sounds (their events have only one variant per layer).
 */
export const SOUND_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  grapple_fire: ['grapple_fire', 'grapple_fire_v2', 'grapple_fire_v3'],
  repulsor_kill: ['repulsor_kill', 'repulsor_kill_v2', 'repulsor_kill_v3'],
  repair_field_activate: [
    'repair_field_activate',
    'repair_field_activate_v2',
    'repair_field_activate_v3',
  ],
  repair_field_end: ['repair_field_end', 'repair_field_end_v2', 'repair_field_end_v3'],
  // THE THRUSTER (bank `sb_007_abl_evade`, event `307114b6` =
  // `play_007_abl_evade_blast_player`, render of 2026-09-03): "1 layer, 1 of 3", the game
  // draws a variant AT EACH dash. Same shape as the grapple, and for the same reason — it is
  // the same kind of gesture, a single impulse without loop or tail.
  thruster_activate: ['thruster_activate', 'thruster_activate_v2', 'thruster_activate_v3'],
  // THE CRANE of Oddball (bank `sb_004_mod_mp_oddball`, render of 2026-08-29): four of its
  // gestures are `RandomSequence` with several `.wem`, exactly like the grapple. The game
  // DRAWS a variant at each reading; the replay does too. `objective_skull_spawn` is not in it:
  // its event is "1 layer, 1 sound", a single file.
  objective_skull_despawn: ['objective_skull_despawn', 'objective_skull_despawn_v2'],
  objective_skull_taken: ['objective_skull_taken', 'objective_skull_taken_v2'],
  objective_skull_pickup: ['objective_skull_pickup', 'objective_skull_pickup_v2'],
  objective_skull_dropped: [
    'objective_skull_dropped',
    'objective_skull_dropped_v2',
    'objective_skull_dropped_v3',
  ],
  // THE SHOTS OF VEHICLE WEAPONS (lot of 2026-09-04): two takes per weapon, drawn at each
  // shot as the game does. The table lives in `vehicleShotSound.ts` (with the join
  // `Shot.w` -> stem and all the doctrine) and merges here so that `soundEvent` attaches
  // them without any caller changing. Their `_1`/`_2` naming (not `stem`/`_v2`) follows the
  // delivery rule of the vehicles lot; the guardrail recognizes them by their prefix to apply
  // to them the duration rule of WEAPONS (1.2 s), not of equipment.
  ...VEHICLE_SHOT_SOUND_VARIANTS,
  // THE DESTRUCTIONS OF VEHICLES (lot of 2026-09-05): three takes per sound set, drawn at
  // each destruction. The table and its doctrine (family -> set join, banks deduplicated
  // by md5 measurement) live in `vehicleDestructionSound.ts` — same mechanics as the shots.
  ...VEHICLE_BOOM_SOUND_VARIANTS,
}

/**
 * soundEvent — the ONLY sound event constructor of the chain: it attaches the variants of
 * the stem when it has them. Going through it everywhere is what guarantees that a gesture
 * with variants cannot be pushed "bare" by a caller who would ignore them.
 */
export function soundEvent(ms: number, stem: string, at?: { x: number; y: number }): ReplaySoundEvent {
  const variants = SOUND_VARIANTS[stem]
  const base = variants ? { ms, stem, variants } : { ms, stem }
  return at ? { ...base, at } : base
}

/**
 * pickVariantStem — THE DRAWING of a variant, at playback. Uniform, like the
 * `RandomSequence` of the game. `rnd` is injectable so that the test is deterministic.
 */
export function pickVariantStem(
  event: Pick<ReplaySoundEvent, 'stem' | 'variants'>,
  rnd: () => number = Math.random,
): string {
  const list = event.variants
  if (!list || list.length === 0) return event.stem
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(rnd() * list.length)))
  return list[i] ?? event.stem
}

/** All the playable stems of an event — what the preloading must cover. */
export function stemsOf(event: Pick<ReplaySoundEvent, 'stem' | 'variants'>): readonly string[] {
  return event.variants && event.variants.length > 0 ? event.variants : [event.stem]
}
