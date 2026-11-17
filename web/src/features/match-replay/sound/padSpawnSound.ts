// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * padSpawnSound.ts — THE APPEARANCE OF A WEAPON ON ITS STAND, dated to the frame.
 *
 * ## Why this file exists, and why its neighbor no longer exists
 *
 * The stand PUBLISHES its moments of appearance (`WeaponPad.spawns`, in frames, on the
 * `Point.T` axis): there is neither player nor deduction, the app plays what the layer dates.
 *
 * ITS SYMMETRIC, THE PICKUP, WAS REMOVED ON 2026-08-30 (`padSound.ts`, deleted) and it is
 * the same boundary that explains it. No channel dates the pickup — `padPickups` gives an
 * interval whose median is 20.00 s, and the loadouts live on the same grid
 * of keyframes. The rule of then deduced it from the first SHOT of a stand weapon family:
 * correct measurements, wrong conclusion. The doctrine of this chain is that the replay STAYS SILENT
 * rather than guessing, and moving a sound to another gesture is not staying silent.
 * **Here, the layer dates; there, it was not dating. That is the whole difference.**
 *
 * ## What the sound is, and what it is not
 *
 * The gesture comes from `sb_004_mod_mp_shared_weaponpad` (`play_004_mod_mp_shared_weaponpad_appear`,
 * `54bd9e43`), name broken by hashing on 2026-08-30 and DESIGNATED by ear by the user on
 * the same day.
 *
 * IT ONLY HOLDS FOR POWER WEAPONS, and that is not a caution on our part: the
 * game Lua keeps the table `MPItemSpawnerAudioAssets` by `MP_WEAPON_TIER.Power`. The user
 * said it in the same terms — "so only the special weapons, not the weapons on racks".
 * The layer, it, publishes ONLY stands: `doc.weaponPads` is the list of the match's stands,
 * the racks are not there. The restriction is therefore held by the source, not by a filter.
 */
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { frameToMs } from '../../../lib/replay/replayLogic'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import { padEquipmentFamilyOf } from '../model/weaponPadFamilies'

/**
 * The sound of the appearance of a WEAPON on a stand. Bank `sb_004_mod_mp_shared_weaponpad`,
 * event `54bd9e43` = `play_004_mod_mp_shared_weaponpad_appear`.
 */
export const PAD_SPAWN_SOUND_STEM = 'objective_pad_spawn'

/**
 * The sound of the appearance of EQUIPMENT on a stand — designated by ear by the user on
 * 2026-08-30 ("Equip 7"). Common bank of equipment `sb_007_abl_shared`, event
 * `4093f3c4`, Wwise name not broken.
 *
 * TWO SOUNDS AND NOT ONE, because the layer already distinguishes the two natures: an equipment
 * stand publishes its FAMILY (`powerup_overshield` / `powerup_camo`) where a weapon stand
 * publishes a weapon family identifier — it is `padEquipmentFamilyOf` that separates them, the
 * same join as the display of the stands (`useReplayWeaponPads`). The game, it, has NO
 * equipment stand bank (measured 2026-08-30: template `sb_004_mod_mp_shared_%s` on
 * the complete dictionary, nothing for equipment) — the sound therefore comes from the common bank,
 * and the designation is that of the ear.
 */
export const EQUIPMENT_PAD_SPAWN_SOUND_STEM = 'equipment_pad_spawn'

/**
 * PAD_SPAWN_MAX_PAR_MATCH — safety ceiling, and it says what it cuts.
 *
 * A match carries 57 stands at the highest noted value, and a stand reappears every 30 to 180 s:
 * the expected order of magnitude is the hundred of appearances. The ceiling is there so that an
 * aberrant artifact (a stand whose cycle runs away) does not drown the track, not to trim a
 * normal match. It is LOGGED by the test, never silent.
 */
export const PAD_SPAWN_MAX_PAR_MATCH = 300

/**
 * padSpawnSoundEvents — one sound per weapon appearance on a stand, sorted, AT THE STAND'S OWN
 * POSITION (`p.x`/`p.y`, the centroid of its appearances): a pad belongs to no one, so there is
 * no "own" to exempt — it stays positional for the followed player too, same as any world
 * sound not tied to a life.
 *
 * No notion of side: a stand belongs to no one. No dependency on the allied side,
 * therefore — unlike the zone state sounds, this one sounds even when the allied team is not
 * resolved (`FilmAllegiance.allyTeam` null: the film does not place the viewed player).
 */
export function padSpawnSoundEvents(doc: ReplayDocumentReady): ReplaySoundEvent[] {
  const pads = doc.weaponPads ?? []
  if (pads.length === 0) return []
  const spawns: { t: number; stem: string; at: { x: number; y: number } }[] = []
  for (const p of pads) {
    const stem = padEquipmentFamilyOf(p.weapon)
      ? EQUIPMENT_PAD_SPAWN_SOUND_STEM
      : PAD_SPAWN_SOUND_STEM
    for (const t of p.spawns ?? []) spawns.push({ t, stem, at: { x: p.x, y: p.y } })
  }
  spawns.sort((a, b) => a.t - b.t)
  return spawns
    .slice(0, PAD_SPAWN_MAX_PAR_MATCH)
    .map((s) => soundEvent(frameToMs(s.t, doc), s.stem, s.at))
}
