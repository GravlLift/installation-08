/**
 * replaySound.ts — WHAT SOUNDS, AND WHEN.
 *
 * FOUR NEIGHBORS, EXTRACTED OVER THE LOTS because this file reaches its ceiling:
 * `replaySoundCursor.ts` holds the playback cursor (an event goes out only once) and
 * `grenadeSound.ts` everything specific to the GRENADE (2026-08-18, lot R2-G);
 * `replaySoundVariants.ts` holds the DRAW of a variant and `objectiveSound.ts` the
 * OBJECTIVE sounds, their side and their silences (2026-08-26). Same rule each time: a family
 * that has its source, its join key and its doctrine deserves its file.
 *
 * THE SOURCES (two, by nature — merge of 2026-08-16): the WEAPON sounds are EXTRACTED
 * FROM THE GAME (weapons-sounds work site: decoded Wwise banks, shots reconstructed according to the
 * proven semantics, selection VOTED by the user — recipe and provenance
 * in `apps/go-api/cmd/weapon-sounds`); the EVENT sounds (throws, explosions, fatal
 * melee, equipment) come from the pack provided by the user (2026-08-13/15). Everything lives
 * under `static/sounds/halo_infinite/`, delivered by `_outils/livraison.py` (weapons only,
 * the events are never touched). TWO FAMILIES OF NAMES, because there are two
 * natures: a WEAPON carries the name of its canonical key (weapon_names.toml, NOT the FR file
 * name of the images — Crémateur/Cindershot trap); an EVENT that the
 * weapons registry does not name carries the name of the event (`throw_*`, `explosion_*`,
 * `melee_kill`). The manifest — the tables below and the two of `grenadeSound.ts` —
 * is the EXACT list of the delivered files; the
 * guardrail `replaySoundAssets.guard.test.ts` replays it against the folder: a stem without
 * a file or a file without a stem breaks the test, never the listening.
 *
 * THE DURATION IS A PROPERTY OF THE CATEGORY, and it is carried by the FILE, not by
 * the player (user decision of 2026-08-16): weapons, throws and melee at 1.2 s;
 * grenade explosions and equipment up to 4 s, because at the second they sounded
 * "cut short". The player plays the file until its end (replayAudio.ts) — extending a
 * sound is therefore re-cutting its asset, never touching the engine.
 *
 * THE LEVEL IS EQUALIZED, AND THAT IS ALSO A PROPERTY OF THE FILE (lot R2-S, 2026-08-18).
 * The 41 assets were delivered at their source level: from -9.20 LUFS (Sentinel beam)
 * to -40.78 LUFS (melee hit), i.e. a gap of 31.58 LU — that is the measurement of the user's
 * remark "overshield activation barely audible" (it was 19 LU below the pulse
 * carbine). They were all renormalized to -16 LUFS integrated, ceiling -1 dBTP, by a STRICT
 * LINEAR GAIN per file (measurement `ffmpeg -af loudnorm` in analysis, gain applied in
 * a second pass): no compression, no limiter, no resampling — duration, sampling
 * frequency, channels and sample count UNCHANGED, the timbre extracted from the game
 * is not retouched. Residual gap: 7.18 LU.
 *
 * FIFTEEN FILES DO NOT REACH -16 LUFS, AND THAT IS PHYSICS, NOT AN OMISSION: their
 * crest factor (gap between the true crest and the integrated level) goes from 15 to 24 dB, so
 * that at the -1 dBTP ceiling they cap between -17.2 and -23.1 LUFS. Raising them to the target
 * would require a limiter, i.e. crushing the transient of a gunshot or the release
 * of an explosion. They are therefore left AS CLOSE AS, ceiling reached exactly: the
 * volley weapons (MA40 AR, MA5K Avenger, Bandit EVO, BR75, MK50 Sidekick, VK78 Commando, Rifle
 * stalker, Disruptor, Cindershot) and the isolated impulses (fragmentation and plasma
 * throws, melee hit, threat sensor, fragmentation and plasma explosions).
 * Raising their integrated level is an ear decision on the
 * TIMBRE, not a gain setting — it is not taken here.
 *
 * WHAT TRIGGERS A SOUND, AND NOTHING ELSE:
 *  - the SHOTS of the film (doc.shots), ALL — see the density rule below;
 *  - the KILLS of the feed (resolved source: thumbnail OR weapon_key, cf. `killSound`) —
 *    the clock is that of the feed, ALREADY APPLIED when they arrive here, the same one that dates the
 *    flash of the cards and the death effect: a sound that would go out on the raw clock
 *    would sound next to its image;
 *  - the GRENADE THROWS (doc.grenades, the author is written in the film), per TYPE, and
 *    the EXPLOSION of EACH grenade at the END OF FLIGHT of its projectile (user decision
 *    of 2026-08-18) — the two forms of the same object, doctrine and tables: `grenadeSound.ts`;
 *  - a MELEE KILL sounds the hit that killed, and a GRENADE KILL the explosion OF ITS
 *    TYPE (it is that which killed, not the gesture of the throw) — the two pass through the THUMBNAIL
 *    of the damage source, not through the weapon_key (cf. below);
 *  - the EQUIPMENT PLACEMENTS (doc.equipmentPlacements, schema 10 — the wall alone): the GESTURE of
 *    placement sounds, at `t0`, AND ONLY IF THE PLACEMENT IS A MEASURED DEPLOYMENT
 *    (`placementIsDeployedObject`, the SAME rule as the layer). Nothing sounds at the end: the
 *    disappearance of a wall is not an act, it is the end of a duration. A family without a file
 *    (the unidentified objects, and all those the naming will add) stays silent. The
 *    sensor, the threat seeker, the repair field and the shroud screen sound by their
 *    DATED USE (`carriedEquipment[].uses`, `carriedUseSound.ts`);
 *  - the EPISODES OF ACTIVE EQUIPMENT (doc.equipmentEpisodes, schema 7 — cloak and
 *    overshield, the two MEASURED families): the start of the episode sounds the activation,
 *    the end sounds the deactivation ONLY when it is MEASURED (`endRead`) — an
 *    episode closed by the death of the bearer does not sound a deactivation, nothing has
 *    measured it and the kill already sounds there. DOCUMENTED CHOICE for the overshield: its end
 *    measured is the EXHAUSTION (return under 100%), and playing the deactivation there is a
 *    staging choice — the user's listening gate will decide;
 *  - the GRAPPLE PULLS (doc.grappleLines, schema 8, lot G of 2026-08-20): the SHOT
 *    sounds at `t0`, one event per pull. Nothing sounds at `t1`: the arrival on the
 *    trajectory closes the window of the layer (`grappleLayer.ts`), that is not a gesture;
 *  - the OBJECTIVE ACTIONS (doc.objectives — lot of 2026-08-26): each one sounds at its frame,
 *    per CANONICAL NAME OF STATISTIC AND IN THE SIDE OF ITS AUTHOR. Detail, scope and
 *    silences: `objectiveSound.ts`.
 *
 * A THIRD SOURCE, SINCE 2026-08-26: the RE of the Wwise banks — banks NAMED by FNV-1 hashing of
 * their identifier, then their events by the same way, then each gesture reconstructed
 * layer by layer at the gains noted. It brings the objective sounds, and REPLACES three
 * files of the user pack AT CONSTANT STEM (`grapple_fire`, `repulsor_kill`,
 * `repair_field_activate`) — same name, game source, and now multiple variants drawn
 * at each read (`replaySoundVariants.ts`).
 *
 * WHY THE THUMBNAIL, AND NOT THE weapon_key, FOR THE GRENADES AND THE MELEE. The registry
 * of weapons carries NEITHER the spike grenade NOR the generic melee: the bridge table
 * `killicon/data/rules.tsv` gives them a line WITHOUT weapon_key (GGGL 3 and MELEE CLASS).
 * What distinguishes them is therefore the only quantity the backend publishes for them — the
 * kill feed thumbnail, which travels in `weaponImageUrl`, and of which the adapter itself says
 * that it "carries the meaning" where the proper name does not exist (adapter_asset_urls.go). The
 * four grenades each have their own (GGGL 0..3 -> killfeed-46..49) and the melee
 * its own (killfeed-65): four distinct explosions and one melee sound, without ever
 * GUESSING a type. The guardrail replays this table against `rules.tsv`.
 *
 * WHAT REMAINS SILENT HERE, AND WHY (measured, not assumed):
 *  - the NON-FATAL MELEE HIT (`Melee - Hit` of the pack): the replay document carries
 *    no damage flow nor impact — its only dated events are the shots, the
 *    throws, the trajectories and the feed of DEATHS (replay/document.go). Wiring it
 *    would require deducing an impact from a shield drop, i.e. inventing it.
 *    The file is therefore not delivered: an asset nothing plays would break the guardrail;
 *  - the 2 AMBIGU grenade labels out of 17 (`damagetag/data/labels.tsv`: effect
 *    generic crossing several `gggl` entries): not publishable, therefore without thumbnail,
 *    therefore without SOUND OF KILL. The type of the damage source is not established: silence, never
 *    the explosion of a neighbor. The grenade concerned keeps its END OF FLIGHT explosion —
 *    the unknown is not the same: what is missing there is the death -> grenade link, not the
 *    type of the throw, which the film publishes with its rank;
 *  - a THROW of which the film does not publish the rank, or publishes a rank out of the four
 *    known types: neither gesture nor explosion. The type is not established, therefore nothing sounds — and
 *    `buildGrenadeRestFx` no longer falls back an absent rank to 0 for this exact reason.
 *
 * THE DENSITY IS NOT FILTERED — USER DECISION OF 2026-08-15, word for word: "put
 * them ALL in as much as possible for the moment, I'll see if it's too much afterwards". There is
 * therefore HERE no editorial rule: neither minimum rate between two shots of the same player,
 * nor priority, nor quota. The ONLY ceiling is TECHNICAL and it lives at the read
 * (`SOUND_MAX_VOICES`, replayAudio.ts): beyond eight simultaneous voices, the sources
 * extra are refused rather than stacking a wall of noise. Measurements of 2026-08-15
 * (simulation at 1x, one voice held 1 s): witness film 000d5950 — 483 sounds for 483 shots,
 * 46 voices refused; corpus of the 23 local artifacts — 17 068 sounds for 17 904 shots (95.3%),
 * 4 897 voices refused (28.7% of the sources). The ceiling BITES, and it is the only one that bounds.
 *
 * A SHOT SOUNDS THE WEAPON THAT PRODUCED IT, NEVER ANOTHER. The join passes through the
 * canonical key published with the label (`weaponLabels[id].key`, set at the request by the
 * service): without a key, or without a file for this key, the shot is SILENT. The weapons that the
 * REGISTRY does not name (Mutilator, turrets, NPC weapons) remain so by construction —
 * same rule as the labels and the effects; their extracted sounds exist in the
 * archive of the work site, ready if the registry names them one day.
 *
 * A WEAPON = A SOUND, EVEN WHEN ITS TAG DECLARES TWO FIRE MODES — inventory of
 * 2026-08-18 (lot R2-S, item S3), answer to the question "are there missing ones?". The
 * "Weapon Fire Sounds" table of the `weap` tag declares the modes of a weapon, and a TRUE mode has its
 * own first-person sound (criterion of the extraction recipe, calibrated on the votes).
 * Passed through this sieve, the 26 weapons of the registry declare ONLY ONE, except TWO:
 *  - Plasma pistol (`hinf_plasma_pistol`, weap 000041b7): modes 1 and 3, the 3 being the
 *    CHARGED shot (overcharge), with its own events `b4e0f7a3` (1P) and `e370a684` (3P);
 *  - Ravager (`hinf_ravager`, weap 05b2c46c): modes 1 and 2, the 2 being the CHARGED shot.
 * None of the two charged modes is delivered: the file played is mode 1 in both cases
 * (Ravager: the 3-shot, `bb31841b`). The CONTINUOUS shot, it, is NOT a second mode of
 * tag: it is the nature of the unique mode of the Sentinel Beam (`a220122d`, role confirmed by
 * the user), and the file delivered for this weapon is its SHORT shot (`503433748`). The
 * two other candidates to the continuous shot are REFUTED by the rate measurement (registry of
 * reports): Cindershot 1 400 ms median gap between two shots, Calcineur 800 ms.
 *
 * WHAT WE DID NOT DO, AND WHY: no file was created for these modes. The replay
 * does not KNOW which mode a shot comes from — the film only publishes the weapon, and the two
 * qualification measurements (charge gauge, rate) are documented NO-GOs. Delivering a sound of
 * charged shot would therefore make it sound on normal shots: that would be the invention this
 * file refuses everywhere. The renders exist in the archive of the work site, ready the day
 * a source qualifies the mode of a shot.
 *
 * A KILL OF WHICH NEITHER THE THUMBNAIL NOR THE KEY ANSWERS (vehicles, explosive objects, damage
 * global, weapons out of registry) = CLEAN
 * SILENCE: never the sound of a neighbor weapon, same rule as the render effects
 * (replay_labels.toml). The generic melee, it, is NO LONGER of those: it has no
 * key but it has a thumbnail, and that is how it sounds.
 *
 * No React, no Web Audio here: pure logic, tested (replaySound.test.ts).
 * The playback (AudioContext, gain envelope) lives in replayAudio.ts.
 */
import type { KillEvent } from '@/features/match-view/_momentum'

import { placementIsDeployedObject } from '../layers/equipmentPlacementsLayer'
import { grenadeSoundEvents } from './grenadeSound'
import type { ReplayLocale } from '../i18n/i18n'
import type { ReplayKill } from '../model/killFeedLogic'
import { bombArmingSoundEvents } from '../model/bombCountdown'
import { objectiveSoundEvents, type ObjectiveSide } from './objectiveSound'
import { padSpawnSoundEvents } from './padSpawnSound'
import { weaponChangeSoundEvents } from './weaponChangeSound'
import { equipmentChangeSoundEvents } from './equipmentChangeSound'
import { abilityImpulseSoundEvents } from './abilityImpulseSound'
import { KNOCKBACK_SOUND_STEM, knockbackSoundEvents, type RepulsorKillSound } from './knockbackSound'
import { translocationSoundEvents } from './translocationSound'
import { riftPoseSoundEvents } from './riftPoseSound'
import { carriedEndSoundEvents, carriedUseSoundEvents } from './carriedUseSound'
import { roundOverSoundEvents } from './roundOverSound'
import { skullSoundEvents } from './skullSound'
import { zoneSoundEvents } from './zoneSound'
import { fireBurstSoundEvents } from './fireBurstSound'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import { vehicleDestructionSound } from './vehicleDestructionSound'
import { vehicleShotSoundStem } from '../model/vehicleWeaponRegistry'

export { pickVariantStem, SOUND_VARIANTS, stemsOf, type ReplaySoundEvent } from './replaySoundVariants'
export { OBJECTIVE_SOUND_STEMS, objectiveSoundStem, type ObjectiveSide } from './objectiveSound'
export { ZONE_SOUND_STEMS, zoneSoundEvents } from './zoneSound'
export { SKULL_SOUND_STEMS, skullSoundEvents } from './skullSound'
export { PAD_SPAWN_SOUND_STEM, EQUIPMENT_PAD_SPAWN_SOUND_STEM, padSpawnSoundEvents } from './padSpawnSound'
export { WEAPON_CHANGE_SOUND_STEMS, weaponChangeSoundEvents } from './weaponChangeSound'
export { EQUIPMENT_PICKUP_SOUND_STEM, equipmentChangeSoundEvents } from './equipmentChangeSound'
export { ABILITY_IMPULSE_SOUND_STEMS, abilityImpulseSoundEvents } from './abilityImpulseSound'
export { KNOCKBACK_SOUND_STEM, knockbackSoundEvents } from './knockbackSound'
export { TRANSLOCATION_SOUND_STEM, translocationSoundEvents } from './translocationSound'
export { RIFT_POSE_SOUND_STEM, RIFT_POSE_HIT_OFFSET_MS, riftPoseSoundEvents } from './riftPoseSound'
export {
  CARRIED_END_SOUND_STEMS,
  CARRIED_USE_SOUND_STEMS,
  carriedEndSoundEvents,
  carriedUseSoundEvents,
} from './carriedUseSound'
export { ROUND_OVER_SOUND_STEMS, roundOverSoundEvents } from './roundOverSound'

/**
 * Category of a sound, for the filter of the settings drawer (phase 2, user decision
 * of 16/08): WEAPONS (shots and weapon kills, same table — cf. WEAPON_SOUND_STEMS), GRENADES
 * (throws AND explosions: it is the same object, in two forms), MELEE (the only
 * fatal hit sounded, `melee_kill`), EQUIPMENT (cloak, overshield).
 */
export type SoundCategory = 'weapon' | 'grenade' | 'melee' | 'equipment' | 'objective'

/**
 * WEAPON sound by weapon_key -> stem of file under static/sounds/{slug}/.
 *
 * A SINGLE TABLE FOR THE SHOTS AND THE WEAPON KILLS: it is the same weapon, therefore the same
 * sound. Separating it in two would make two truths to keep up to date, and the day they
 * diverged a shot and the kill it produces would no longer sound the same.
 *
 * THE GRENADES ARE NOT THERE, and that is not an omission: the film does not publish any SHOT of
 * grenade (measurement of 2026-08-15 on the 23 local artifacts: 0 of the 17 904 shots carries a
 * grenade key). They have their two tables to themselves, one per form of the same object — the
 * gesture (THROW_SOUND_STEMS) and the detonation (EXPLOSION_SOUND_STEMS) — and each its own
 * clock.
 *
 * A key absent from this table = clean silence.
 */
export const WEAPON_SOUND_STEMS: Readonly<Record<string, string>> = {
  hinf_ma40_ar: 'hinf_ma40_ar',
  hinf_br75: 'hinf_br75',
  hinf_cqs48_bulldog: 'hinf_cqs48_bulldog',
  hinf_cindershot: 'hinf_cindershot',
  hinf_vk78_commando: 'hinf_vk78_commando',
  hinf_disruptor: 'hinf_disruptor',
  hinf_energy_sword: 'hinf_energy_sword',
  hinf_gravity_hammer: 'hinf_gravity_hammer',
  hinf_heatwave: 'hinf_heatwave',
  hinf_hydra: 'hinf_hydra',
  hinf_mangler: 'hinf_mangler',
  hinf_needler: 'hinf_needler',
  hinf_plasma_pistol: 'hinf_plasma_pistol',
  hinf_pulse_carbine: 'hinf_pulse_carbine',
  hinf_ravager: 'hinf_ravager',
  hinf_s7_sniper: 'hinf_s7_sniper',
  hinf_sentinel_beam: 'hinf_sentinel_beam',
  hinf_shock_rifle: 'hinf_shock_rifle',
  hinf_sidekick: 'hinf_sidekick',
  hinf_skewer: 'hinf_skewer',
  hinf_m41_spnkr: 'hinf_m41_spnkr',
  hinf_stalker_rifle: 'hinf_stalker_rifle',
  // The four that the initial pack did not have — the game extraction provides them.
  hinf_bandit: 'hinf_bandit',
  hinf_ma5k_avenger: 'hinf_ma5k_avenger',
  hinf_fuel_rod_spnkr: 'hinf_fuel_rod_spnkr',
  hinf_vestige_carbine: 'hinf_vestige_carbine',
}

/**
 * Sound of a KILL of which the DAMAGE SOURCE has no weapon_key SIDE WEAPONS REGISTRY —
 * grenades, melee, and now the repulsor: the kill feed thumbnail -> sound + category.
 *
 * THE KEY IS THE STEM OF THE THUMBNAIL (`killfeed-NN`), because that is the only quantity that
 * the backend publishes for these sources: `killicon/data/rules.tsv` gives them a line without
 * weapon_key (GGGL 3 = spike grenade, MELEE CLASS = gesture shared by the whole arsenal,
 * NAME Repulsor = equipment out of the weapons registry — cf. below). The order of the grenades
 * is that of the repo, established by two independent chains: 0 Fragmentation, 1 Plasma,
 * 2 Dynamo, 3 Spike (RECETTE_LOADOUT §8, replay_labels.toml), and `rules.tsv` reports it as
 * is on the thumbnails 46 to 49.
 *
 * THIS TABLE PASSES BEFORE WEAPON_SOUND_STEMS on a kill: the three grenades that HAVE a
 * key (frag, plasma, dynamo) would otherwise sound two competing truths. A thumbnail
 * absent from this table (the weapons of the registry, the vehicles, the objects) falls back to the
 * canonical key, and a source without a thumbnail at all stays silent.
 *
 * SINCE 2026-08-18, IT IS NO LONGER THE ONLY SOURCE OF EXPLOSION: the end of flight of
 * each grenade schedules one (EXPLOSION_SOUND_STEMS). What this table keeps in
 * its own, it is the MELEE — and, for the grenades, the priority to the deduplication.
 *
 * THE VALUE CARRIES THE CATEGORY WITH THE STEM (type `KillSound`, defined below), and that
 * is no longer a simple stem since the repulsor (lot R6, 2026-08-25): before it, this
 * table only contained GRENADES and THE melee, two categories that a simple test
 * `stem === 'melee_kill'` was enough to distinguish in `killSound`. The repulsor breaks this
 * binary assumption — its category is WEAPON (weapon), not grenade — hence the passage to a
 * table that names its category EXPLICITLY rather than re-deducing it from a stem at the point
 * of read (same principle as EQUIPMENT_SOUND_STEMS: a single truth, carried by the
 * table, never reconstructed elsewhere).
 *
 * THE REPELLER (`killfeed-56` -> `repulsor_kill`, category `weapon`) JOINS THIS TABLE
 * AND NOT `WEAPON_SOUND_STEMS`, while it now has a proper name side Go
 * (`damagetag/data/labels.tsv`: WEAPON UNDER_RESERVE "Repulsor"): that name does NOT have a
 * `weapon_key` in the weapons registry (`killicon/data/rules.tsv`, rule NAME Repulsor,
 * weapon_key column EMPTY — same situation as Mutilator and Sandwich, weapons OUT OF
 * registry). Without weapon_key, `WEAPON_SOUND_STEMS` can never answer for it; only
 * the thumbnail can, exactly like the melee and the grenades before it. Identification
 * of the `jpt!` (07104b31) by RE offline via `himap` (lot R6, 2026-08-25): chain
 * `eqip 7ca85adc` (repulsor, `replay_labels.toml`) -> `sofa 6845f2b3` -> `eqip` brother
 * `1e79ebda` -> `jpt! 07104b31`, thruster discarded (distinct eqip 0x430dda48/0xeef5d48d).
 * Detail: `damagetag/data/labels.tsv` and `killicon/data/rules.tsv`.
 *
 * The guardrail `replaySoundAssets.guard.test.ts` replays these six keys against `rules.tsv`:
 * an atlas index that moved, or a sixth source without weapon_key, breaks the test —
 * never the listening.
 */
export const KILL_SPRITE_SOUND_STEMS: Readonly<Record<string, KillSound>> = {
  'killfeed-46': { stem: 'explosion_frag', category: 'grenade' },
  'killfeed-47': { stem: 'explosion_plasma', category: 'grenade' },
  'killfeed-48': { stem: 'explosion_dynamo', category: 'grenade' },
  'killfeed-49': { stem: 'explosion_spike', category: 'grenade' },
  'killfeed-65': { stem: 'melee_kill', category: 'melee' },
  'killfeed-56': { stem: 'repulsor_kill', category: 'weapon' },
  // THE FOUR COILS (2026-08-27). A coil kill had NO icon until now, and the
  // cause was technical, not doctrinal: the three-segment cut that extracts the root of
  // bank made `exp_single_small_{shock,plasma,kineticunsc,hardlight}` all identical.
  // The LONG root distinguishes them, and the atlas carries their four thumbnails since the naming pass of
  // 2026-08-09. The sound is the event with FIVE SIMULTANEOUS LAYERS of each bank
  // — the only of the three it carries that is the complete explosion, the two others being
  // perspectives (RE of 2026-08-26, §5).
  //
  // WEAPON CATEGORY, like the repulsor: a coil kills by explosion, but it is a damage source
  // of the decoration, not a thrown grenade — and the settings drawer has no "decoration" case.
  'killfeed-42': { stem: 'coil_shock', category: 'weapon' },
  'killfeed-43': { stem: 'coil_blast', category: 'weapon' },
  'killfeed-44': { stem: 'coil_fusion', category: 'weapon' },
  'killfeed-45': { stem: 'coil_plasma', category: 'weapon' },
}

/**
 * EQUIPMENT sounds per episode family (`fam` of the document) -> stems of activation and of
 * deactivation. The key is the STABLE identifier published by the artifact — a family out of
 * table (a future equipment not measured) stays silent, never the sound of a neighbor.
 * The guardrail `replaySoundAssets.guard.test.ts` replays these stems against the folder.
 */
export const EQUIPMENT_SOUND_STEMS: Readonly<
  Record<string, { activate: string; deactivate: string }>
> = {
  camo: { activate: 'camo_activate', deactivate: 'camo_deactivate' },
  overshield: { activate: 'overshield_activate', deactivate: 'overshield_deactivate' },
}

/**
 * Sound of a PLACEMENT of equipment per FAMILY (`family` of the document, schema 10) -> stem of the file
 * played at `t0`, the moment of the gesture.
 *
 * THIS TABLE NO LONGER CARRIES THAN THE WALL (2026-10-15). The film no longer produces a `deployed` placement for
 * the sensor, the threat seeker, the repair field and the shroud screen since the 15/09 rule: they
 * sound now by their DATED USE (`carriedEquipment[].uses`, `carriedUseSound.ts`),
 * with the stems whose provenance is written below. A family is only in one of the two
 * tables: the wall, whose placement follows the use by two or three frames, would sound twice.
 *
 * A DISTINCT TABLE FROM `EQUIPMENT_SOUND_STEMS`, and that is not a duplication: the two
 * speak of equipment, but not of the same OBJECT. One carries EPISODES OF STATE on the
 * bearer (cloak, overshield: a start AND an end measured); this one carries OBJECTS
 * PLACED on the terrain, of which only the placement gesture is an event — the disappearance of a wall
 * is not an act, it is the end of a duration, and nothing sounds it. Merging them would force
 * each family to declare a deactivation it does not have.
 *
 * A family absent from this table is SILENT (the unidentified objects, `other`, and all
 * the families the naming lot will add without sound) — never the sound of a neighbor, same
 * rule as everywhere else here. The guardrail `replaySoundAssets.guard.test.ts` replays these
 * stems against the assets folder.
 *
 * THE THREAT SEEKER TAKES THE SENSOR'S SOUND, AND THAT IS NOT "THE SOUND OF A NEIGHBOR" (decision
 * user of 2026-08-18). The general rule of this file — a family without a source stays
 * silent — holds against ARBITRARY BORROWINGS: giving the repair field the sound of the wall
 * would assert an object for another. Here, the threat seeker and the threat sensor
 * are the SAME device in the game, to one mode near: the sensor sweeps its zone in loop, the
 * seeker emits a single impulse. The gesture of PLACEMENT, it, is identical — it is the same
 * box that is released. The borrowing is therefore based on a kinship, written here and tested, and not
 * on the fact that "a sound remains available".
 *
 * THE REPAIR FIELD HAS SOUNDED SINCE 2026-08-18, AND ITS SOUND COMES FROM THE GAME. The survey of
 * the lot R3 concluded "the extraction chain does NOT know the `eqip` group". It knows it
 * now (`PLAN_EQUIPEMENTS_MANQUANTS_SONS`, phase 3): `cmd/weapon-sounds`, modes
 * `eqip-sons` then `eqip-banks`, chain
 * `eqip -> effe -> snd! -> Wwise event -> sbnk -> .wem`.
 *
 * WHY THE LINK `effe` IS INDISPENSABLE, and why no one had seen it: the table
 * of dependencies of an `eqip` carries only two `snd!`, and those are the SAME for 21 objects
 * of equipment — from the wall to the overshield. It is the EFFECT (`effe`) that is specific to a gesture.
 *
 * WHAT DESIGNATES THIS FILE, and not another of the 35 `.wem` of the bank: the `eqip`
 * `5c8e2316` (the device of the repair field, second `eqip` of the `sofa` `0e1febf8` =
 * `repair_field`) reaches the bank `5724312f`, that NO other `eqip` of the game reaches, and
 * of which 4 `.wem` fall in the pack `sb_007_abl_repairfield.pck` — the game names it itself.
 * Its unique `snd!` (`22c2323a`) designates two events that render THE SAME three `.wem`,
 * uniform variants of a single `RandomSequence`: there is no choice to make, only a
 * draw.
 *
 * WHAT CHANGED ON 2026-08-27, AND THAT IS A CORRECTED ERROR, NOT A SETTING. The file
 * delivered since 2026-08-18 was the gesture of PLACEMENT (`play_007_abl_repairfield_deploy_player`,
 * event `8ed46d21`, 0.38 s) — a clatter of object released. The ACTIVATION of the field is an
 * other event, `play_007_abl_repairfield_activate` (`c48cf171`, 3.26 s), and that is the one
 * that the user wants to hear when a player places the field (decision of 2026-08-27,
 * after listening of the board). The two events did not distinguish before the naming
 * of the banks by hashing: the tag chain led to the two without saying which was which.
 * The three variants delivered are now the three `.wem` of `c48cf171`
 * (143632032 / 222530989 / 640887009), path gain +1 dB applied.
 *
 * EQUALIZATION: true crest capped at -1.0 dBTP by LINEAR GAIN (-0.8 / -1.0 / -2.0 dB),
 * ceiling of the lot R2-S, same convention as `repair_field_end`.
 *
 * THE RIFT OF THE TRANSPORTER DOES NOT SOUND BY THIS TABLE: its placement is not a placement of object of
 * the world, it is the energy of the CARRIED transporter that falls to zero (`riftPoses`, schema 95). It
 * sounds by `riftPoseSound.ts`, its teleportation by `translocationSound.ts`.
 *
 * REMAIN OUT OF THIS TABLE, by decision and not by lack: the repulsor (that `PLACEMENT_RENDER`
 * does not DRAW either — it is a capability, not a placed object; it sounds by its push
 * (`knockbackSound.ts`) and by its kill),
 * the two bonuses, and the unidentified object `other` (it nevertheless
 * HAS its bank, `92c830f5`, 38 `.wem` — but an object we do not know how to name does not have to
 * announce itself, and its drawing depends on a toggle that the sound does not share). THE GRAPPLE
 * (lot G, 2026-08-20) AND THE THRUSTER (2026-09-03) ARE NO LONGER: they sound by THEIR
 * OWN tables — `GRAPPLE_SOUND_STEM` below (`doc.grappleLines`, schema 8) and
 * `ABILITY_IMPULSE_SOUND_STEMS` (`abilityImpulseSound.ts`, `doc.abilityImpulses`, schema 38).
 * They are not placed objects in the sense of THIS table.
 */
export const EQUIPMENT_PLACEMENT_SOUND_STEMS: Readonly<Record<string, string>> = {
  wall: 'wall_activate',
}

/**
 * Sound of the SHOT of grapple (doc.grappleLines, schema 8, lot G of 2026-08-20) — A SINGLE stem,
 * no family: each pull sounds the same shot, whatever the slot. Category
 * EQUIPMENT (the grapple is a player equipment object, same as cloak
 * and overshield) — cf. `buildSoundTimeline`.
 *
 * SOURCE DISTINCT FROM THE TWO DESCRIBED AT THE TOP OF THE FILE: a user archive of sounds
 * extracted from the game (Nov. 2021), variant "Activate (Hit Short)" — supervisor decision, lot
 * G. 1.687 s, above the weapons' cut (1.2 s): kept in full, like the
 * equipment. EQUALIZATION: LINEAR GAIN of +15.07 dB (measured -31.07 LUFS / -16.95 dBTP in
 * entry), result -16.01 LUFS / -1.88 dBTP — target and ceiling of the lot R2-S reached.
 */
export const GRAPPLE_SOUND_STEM = 'grapple_fire'

/**
 * THE CATEGORIES THE USER CAN CUT. They were five (phase 2, decision of
 * 16/08); "Objectives" was out since 2026-09-02 on user feedback — "it wasn't
 * clear at all": in a list of toggles, "Objectives" reads like a LAYER, not like
 * a family of sounds. The objective sounds play now always.
 *
 * IT IS NOT THE LIST OF CATEGORIES: the SoundCategory type still counts five, because
 * classifying a sound remains useful. That is the list of what is SET. A stored preference that
 * would still name "objective" is no longer read back, and the category relights itself.
 */
/**
 * The sub-type of the SETTABLE categories. It exists so that the compiler holds the pair:
 * a category removed from here must lose its i18n label, and vice versa. Without it, the
 * removal of "Objectives" compiled with a label missing at execution.
 */
export type TogglableSoundCategory = Exclude<SoundCategory, 'objective'>

export const SOUND_CATEGORIES: readonly TogglableSoundCategory[] = [
  'weapon',
  'grenade',
  'melee',
  'equipment',
]

/** Filter per category: one entry per category, `true` = category audible. */
export type SoundCategoryFilter = Readonly<Record<SoundCategory, boolean>>

/** The behavior OF TODAY, unchanged by default: everything sounds. */
export const SOUND_CATEGORIES_DEFAULT: SoundCategoryFilter = {
  weapon: true,
  grenade: true,
  melee: true,
  equipment: true,
  objective: true,
}

/**
 * shotSoundStem — the file of a SHOT, or undefined for silence.
 *
 * The film dates the shot and names its weapon by an identifier; the canonical key arrives with
 * the label (`weaponLabels[id].key`). No direction is required — that is the whole point
 * of the sound: it only needs the moment (user request of 2026-08-15).
 *
 * TWO JOINS SINCE THE VEHICLES LOT (2026-09-04), IN THIS ORDER: the weapons registry
 * first (the player weapons, fired on foot OR from a seat), then the WEAPONS OF VEHICLE
 * — their identifiers are ABSENT from `weaponLabels`, it is the REGISTRY OF VEHICLE WEAPONS
 * of the document that names them (schema 69, `vehicleWeaponRegistry.ts`; it replaces the client table
 * of the lot). Neither of the two answers, or silence decided by the registry = clean silence.
 *
 * THE CARRIER IS NOT READ (feedback of 2026-09-23, lot L1.5): the weapon alone decides, no chassis
 * is sought.
 */
export function shotSoundStem(
  doc: ReplayDocumentReady,
  shot: { w?: string },
): string | undefined {
  if (!shot.w) return undefined
  const key = doc.weaponLabels?.[shot.w]?.key
  if (key) return WEAPON_SOUND_STEMS[key]
  return vehicleShotSoundStem(doc, shot.w)
}

/**
 * killSourceSpriteStem — the stem of the thumbnail of a damage source, read in its URL.
 *
 * The backend composes `/static/weapons-assets/{slug}/jeu/killfeed-NN.png` (adapter_asset_urls.go,
 * `static.URL`: neither fingerprint nor version parameter). The stem is therefore the file name
 * without its extension. Nothing to extract = empty string, never an assumption.
 */
export function killSourceSpriteStem(imageURL: string | undefined): string {
  const path = (imageURL ?? '').split('?')[0]
  const file = path.slice(path.lastIndexOf('/') + 1)
  return file.endsWith('.png') ? file.slice(0, -'.png'.length) : ''
}

/** A resolved kill sound, with the category that answered — serves the filter per category. */
interface KillSound {
  stem: string
  category: Extract<SoundCategory, 'weapon' | 'grenade' | 'melee'>
}

/**
 * killSound — TWO JOINS, IN THIS ORDER: the thumbnail of the source first (it is that
 * which knows to distinguish the four grenades, the melee and the repulsor, that the weapons registry
 * does not name), the canonical key after (the weapons OF the registry). Neither of the two answers
 * = clean silence. It returns the stem AND the category, because `buildSoundTimeline` has
 * need of the two: the file to play, and the category that the drawer's filter can cut.
 *
 * NO MORE MELEE/GRENADE TERNARY HERE (lot R6, 2026-08-25): while
 * `KILL_SPRITE_SOUND_STEMS` only carried grenades and THE melee, a test
 * `stem === 'melee_kill'` was enough to decide the category. The repulsor (category WEAPON)
 * broke this binary assumption — the table now names its category EXPLICITLY
 * (type `KillSound`), and this function restores it as is: a single truth, carried
 * by the table, never re-guessed here from the stem.
 *
 * EXPORTED TO BE UNIT-TESTED, and that is its only production caller
 * (`buildSoundTimeline`) that gives it its meaning. The facade `killSoundStem`, which only
 * exposed its stem, was REMOVED on 2026-08-16: the filter per category took it
 * its last production caller, and an export that survives only by its tests is the
 * dead code that rule 7 of CLAUDE.md forbids. Its cases are tested in
 * `replaySound.test.ts`, augmented with the category — the new information of the filter.
 */
export function killSound(kill: Pick<KillEvent, 'weaponKey' | 'weaponImageUrl'>): KillSound | undefined {
  const sprite = killSourceSpriteStem(kill.weaponImageUrl)
  const bySprite = sprite ? KILL_SPRITE_SOUND_STEMS[sprite] : undefined
  if (bySprite) return bySprite
  const byKey = kill.weaponKey ? WEAPON_SOUND_STEMS[kill.weaponKey] : undefined
  return byKey ? { stem: byKey, category: 'weapon' } : undefined
}

/**
 * buildSoundTimeline pre-computes the sound track of the document: SHOTS dated by their frame of
 * film + kills ALREADY REALIGNED by the feed (`killsOfFeed` — a single clock, and a single
 * realignment: neither this module nor the death effect replays it, 2026-09-05 J2) + throws of
 * grenade and end-of-flight explosions. Sorted chronologically, built once.
 *
 * THE SHOTS AND THE KILLS COEXIST WITHOUT DEDUPLICATION, and that is intentional: the shot that kills is
 * an event of the film, the death it causes is another, dated by the feed. Merging them
 * would make one of the two disappear on a clock where they do not fall at the same moment.
 *
 * `categories` (settings drawer, phase 2) REMOVES AT CONSTRUCTION the categories
 * cut by the user — never downstream, in the player: a category cut does
 * not even pre-load its files. By default, everything sounds (SOUND_CATEGORIES_DEFAULT):
 * a caller that does not pass this 4th parameter keeps today's behavior, as
 * is — that is the case of all existing calls before this table.
 */
export function buildSoundTimeline(
  doc: ReplayDocumentReady,
  kills: readonly ReplayKill[],
  categories: SoundCategoryFilter = SOUND_CATEGORIES_DEFAULT,
  sideOfXuid?: (xuid: string) => ObjectiveSide,
  // The ALLIED side, in team number — the key of the ZONE STATE sounds, which join on the
  // owner of a zone and not on the xuid of a player (`zoneSound.ts`). `null` = side not
  // resolved: capture in progress and score ticks stay silent, the new hill sounds anyway.
  allyTeam: number | null = null,
  // THE LANGUAGE OF THE INTERFACE — the only locale-aware entry of the track: the "round
  // ended" sound is an ANNOUNCER'S VOICE (`roundOverSound.ts`). Absent (old calls, availability
  // measurement), this sound stays silent: the replay does not guess a language.
  locale?: ReplayLocale,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  if (categories.weapon) {
    for (const s of doc.shots) {
      const stem = shotSoundStem(doc, s)
      if (stem) out.push(soundEvent(frameToMs(s.t, doc), stem, { x: s.x, y: s.y }))
    }
    // THE CONTINUOUS SHOT (schema 71, lot M4b): each burst holds its loop, or replays its shot
    // at the rate of the weapon, and ends on the tail shot. Doctrine: `fireBurstSound.ts`.
    out.push(...fireBurstSoundEvents(doc, (w) => shotSoundStem(doc, { w })))
    // THE PICKUPS AND DROPS OF WEAPON (schema 25): dated by `weaponChanges`, nothing more to
    // deduce — that is the channel that replaced the rule "at the first shot" removed the same
    // day. Doctrine, sounds and choice of `swapped`: `weaponChangeSound.ts`.
    out.push(...weaponChangeSoundEvents(doc))
    // The DESTRUCTION of a vehicle (schema 30, lot of 2026-09-05): the SAME signal as
    // the visual effect — `end === VEHICLE_END_DESTROYED` AND `tEnd` published, nothing else.
    // INERT TODAY: every existing artifact publishes `end: "unknown"`, therefore zero
    // events — the sound is ready, it does not invent the measurement. A one-shot sound effect,
    // category WEAPONS of the drawer (like the coils), never the engine bus. Doctrine,
    // deduplicated sets of sounds and join family -> set: `vehicleDestructionSound.ts`.
    for (const v of doc.vehicles) {
      const boom = vehicleDestructionSound(v)
      if (boom) out.push(soundEvent(frameToMs(boom.frame, doc), boom.stem))
    }
  }
  // The explosions scheduled BY A KILL, kept in passing: they are the ones that
  // deduplicate the ends of flight, and they therefore must be known before.
  const killExplosions: ReplaySoundEvent[] = []
  // The repulsor kills scheduled: the push of the same moment is not replayed (knockbackSound.ts).
  const repulsorKills: RepulsorKillSound[] = []
  if (kills.length > 0 && doc.tracks.length > 0) {
    for (const k of kills) {
      const snd = killSound(k)
      if (!snd || !categories[snd.category]) continue
      const ev = soundEvent(k.replayMs, snd.stem)
      out.push(ev)
      if (snd.category === 'grenade') killExplosions.push(ev)
      if (snd.stem === KNOCKBACK_SOUND_STEM) repulsorKills.push({ ms: ev.ms, xuid: k.xuid })
    }
  }
  // The "grenades" filter covers the TWO forms of the object, as since 16/08: cutting
  // the category cuts the throws AND the explosions, including those of the kills above.
  if (categories.grenade) out.push(...grenadeSoundEvents(doc, killExplosions))
  // The episodes of active equipment: the activation at the start, the deactivation ONLY
  // on a MEASURED end (`endRead`) — an episode closed by the death sounds nothing more,
  // the kill already sounds there and nothing has measured a deactivation.
  if (categories.equipment) {
    for (const e of doc.equipmentEpisodes) {
      const stems = EQUIPMENT_SOUND_STEMS[e.fam]
      if (!stems) continue
      out.push(soundEvent(frameToMs(e.t0, doc), stems.activate))
      if (e.endRead) out.push(soundEvent(frameToMs(e.t1, doc), stems.deactivate))
    }
    // The PLACEMENTS of equipment (schema 10): the GESTURE sounds, at `t0`, and it alone. The end of life
    // of a wall is not an act — it is the end of a measured duration, and nothing sounds it.
    //
    // THE FILTER IS THAT OF THE LAYER, AND IT IS SHARED INTENTIONALLY. On the 11 calibrated films,
    // 88.6% of the placements are objects DROPPED AT THE DEATH of the bearer: sounding them would make go out
    // a "wall deployed" at each death holding a wall — 91 times out of 222 placements of wall, 106 times
    // out of 155 placements of sensor. And a wall really deployed produces TWO placements (the device and
    // its panels): without the panels rule, it would sound twice.
    for (const p of doc.equipmentPlacements) {
      if (!placementIsDeployedObject(p)) continue
      const stem = EQUIPMENT_PLACEMENT_SOUND_STEMS[p.family]
      if (stem) out.push(soundEvent(frameToMs(p.t0, doc), stem))
    }
    // The PULLS of grapple (schema 8): the SHOT sounds at `t0`, one event per pull —
    // no end sounded, `t1` only closes the window of the layer (`grappleLayer.ts`).
    for (const g of doc.grappleLines) {
      out.push(soundEvent(frameToMs(g.t0, doc), GRAPPLE_SOUND_STEM))
    }
    // THE PICKUP ON STAND WAS REMOVED ON 2026-08-30, and it must say why rather than
    // leave a silent hole. It sounded at the FIRST SHOT of a stand weapon family, lacking a
    // channel that dates the pickup (`padPickups`: median of 20.00 s between `tLow` and `tHigh`;
    // loadouts on the same grid of keyframes, 0 out of 597 dated less than 5 s). The measurements
    // were correct, the conclusion was not: the doctrine of this chain is that the replay
    // STAYS SILENT rather than guessing, and we had moved the sound to ANOTHER gesture — it went out
    // at the same time as a shot, it went out for a weapon taken from the ground or from a dead, and it
    // never went out for a weapon picked up without being fired. User decision of 2026-08-30:
    // stay silent until a channel DATES the pickup. The sound, it, remains identified
    // (`play_007_abl_shared_pickup`, event `c73036e4`) and audible on the board
    // `3c84fab7-5e36-4777-a2d9-bd1c90b08f65`; it is no longer delivered while nothing triggers it.
    //
    // THE APPEARANCE ON STAND — weapon OR equipment, each its sound: the layer DATES the moment
    // (`weaponPads[].spawns`) and publishes the family that separates them. Detail: `padSpawnSound.ts`.
    out.push(...padSpawnSoundEvents(doc))
    // THE PICKUP OF EQUIPMENT (schema 26): dated by `equipmentChanges`. The sound waited for this
    // moment since 2026-08-27; the consumption remains silent (it already sounds by its
    // family). Doctrine: `equipmentChangeSound.ts`.
    out.push(...equipmentChangeSoundEvents(doc))
    // THE USE OF A CAPABILITY THAT PROPULSES ITS CASTER (schema 38): the thruster, dated by the
    // film and validated 5/5 against a Theater survey. One sound per published impulse, at its frame;
    // no end sounded — the gesture IS an impulse. Table per family: `abilityImpulseSound.ts`.
    out.push(...abilityImpulseSoundEvents(doc))
    // THE PUSH OF THE REPELLER (schema 94) AND THE TELEPORTATION OF THE TRANSPORTER (schema 38): two
    // gestures that the film dates. Doctrine: `knockbackSound.ts`, `translocationSound.ts`.
    out.push(...knockbackSoundEvents(doc, repulsorKills))
    out.push(...translocationSoundEvents(doc))
    // THE PLACEMENT OF THE RIFT (schema 95): its HIT at the moment of the placement. Doctrine: `riftPoseSound.ts`.
    out.push(...riftPoseSoundEvents(doc))
    // THE USE of the sensor, the seeker, the field and the screen (schema 95), at the frame where the film
    // dates it. Doctrine: `carriedUseSound.ts`.
    out.push(...carriedUseSoundEvents(doc))
    // THE END OF THE REPAIR FIELD: the deletion, written by the film, of the object it spawns.
    out.push(...carriedEndSoundEvents(doc))
  }
  // The OBJECTIVE ACTIONS: each one sounds at its frame, in the side of its author. Without
  // a side resolver (caller that does not have the film's allegiance), the only actions that
  // sound are those without a team variant — the replay never guesses a side.
  if (categories.objective) {
    out.push(...objectiveSoundEvents(doc, sideOfXuid))
    // The ZONE STATE sounds: capture in progress, domination, move of the hill. They do
    // not come from any player — their source is `doc.zoneStates`, not `doc.objectives` — but
    // they belong to the same category of the drawer, and are cut therefore with it.
    out.push(...zoneSoundEvents(doc, allyTeam))
    // THE SOUND OF THE ARMED BOMB (Assault, schema 29): an event at the start of each fuse.
    // Its source is `doc.bombArmings`, not `doc.objectives` — the channel of the ring ti=12 does not
    // name any player. The stem is that of the NEW HILL, borrowed by reference
    // (user decision of the port): doctrine and provenance in `bombCountdown.ts`.
    out.push(...bombArmingSoundEvents(doc))
    // THE SOUNDS OF THE SKULL of Oddball: pickup and drop. Their source is `doc.skullCarries`
    // (schema 23), not `doc.objectives` — the statborg naming does not cover Oddball. They
    // have no side: the mode's bank does not carry a `_team`/`_enemy` variant on
    // these gestures. Doctrine and inventory of what remains out: `skullSound.ts`.
    out.push(...skullSoundEvents(doc, allyTeam))
    // THE SOUND "ROUND ENDED", on the same measurement as the inter-round message: the flip
    // of a round to the next (`roundTransitions`, roundsLogic), dated by the score layer.
    // WIRED since 2026-08-28 (the announcer asset FR/EN was provided) — exactly as the
    // stub that lived here announced it. Without `locale`, it stays silent: a voice has a language, and the
    // replay does not guess one. Table of stem and doctrine: `roundOverSound.ts`.
    if (locale) out.push(...roundOverSoundEvents(doc, locale))
  }
  return out.sort((a, b) => a.ms - b.ms)
}
