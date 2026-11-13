/**
 * vehicleShotSound.ts — THE VARIANTS OF THE SOUND OF A SHOT IN VEHICLE (lot of 2026-09-04).
 *
 * SINCE SCHEMA 69 (replay feedback of 2026-09-23, lot M4a), WHICH WEAPON SOUNDS WHICH STEM
 * IS NO LONGER DECIDED HERE. The table `Shot.w -> stem` of this file was keyed by `weap` tags
 * of the game module, most of which did not appear in any film (7 out of 11 in the corpus of
 * 2026-09-23). The TITLE REGISTRY replaces it (`config/titles/{slug}/mappings/vehicle_weapons.toml`,
 * key = OBSERVED tag, `sound` = the stem of the first variant, or `silence` and its reason); the
 * document publishes it and `model/vehicleWeaponRegistry.ts` reads it. This file keeps only what
 * the registry does not say: the TWO TAKES of each sound, for the drawing per shot.
 *
 * THE SOURCES ARE THE Wwise RECONSTRUCTIONS VALIDATED BY THE USER (manifeste_v3.json,
 * rev12), delivered in TWO variants (two takes of the
 * same perspective), cut to the WEAPONS rule (1.2 s max), 48 kHz / 16 bits / stereo,
 * equalized to the convention of the lot R2-S (-16 LUFS targeted, ceiling -1 dBTP, LINEAR gain
 * only). Perspective: the "3rd person" take (spectator view) by default, except by ear designation
 * (Wraith and Banshee M2: "cockpit view take 1", 2026-09-04; Banshee M1: the ORIGINAL
 * reconstruction of 0.125 s, 2026-09-05 — the "tag rate" track was abandoned on the re-listening).
 *
 * VARIANTS OF WEAPONS WITH CONTINUOUS SHOT (Ghost, Banshee M1, Chopper, LMG of the Falcon, LMG of the Wasp)
 * remain here even though no film publishes them yet: they are DELIVERED ASSETS, not keys of
 * tag — the registry will name them the day the decoder reads the continuous shot (lot M4b).
 *
 * DELIVERY OF 2026-09-24 (replay feedback, lot M6.1; sounds designated BY EAR by
 * the user on the listening page `rr_2026-09-23`, "the first candidates are all good").
 * Sources: V3E renders out of the repository (`Halo Infinite - Sons v75/rr_2026-09-23/`, manifest
 * `manifeste_rr_2026-09-23.json`: complete path gains, one common normalization per render).
 * Same recipe as the delivery of 2026-09-04 (same RIFF header `Lavf`, measured on the stems
 * delivered): cut at 1.2 s with a 50 ms output fade for a longer shot, shorter source
 * delivered whole; LINEAR gain = min(-16 LUFS - integrated, -1 dBTP - true crest), crest
 * only under 0.4 s (integrated not measurable); 48 kHz / 16 bits / stereo.
 *  - WASP MISSILES (`vehicle_shot_wasp_*`): REPLACED by the rebalanced render
 *    (`wasp_missiles_controle/coup_3p*`, event e22a0d32, layers at +22 / +13 / +8 dB instead
 *    of the +7.8 / +2.8 / +0.8 dB of the old render rev9 — same media, proof in the manifest).
 *  - WASP LMG (`vehicle_shot_wasp_lmg_*`, event 5baca8ee, tag rate 600/min): the
 *    3P LOOP (8 s, `boucle_8s_3p`) held during the shot and the ISOLATED 3P SHOT (0.2 s, two takes)
 *    in the tail at the stop. The loop is equalized by the recipe; the tail receives the SAME gain
 *    referred to the render (manifest normalization gap: 1.64 against 3.97 dB), so that the
 *    last shot does not sound louder than the burst it ends. Wiring: lot M4b. THE
 *    LOOP IS IN NO PRODUCTION TABLE until nothing plays it (0 dead code): it is
 *    DEPOSITED and declared to the assets guardrail (`replaySoundAssets.guard.test.ts`,
 *    `DEPOSES_POUR_M4B`, with its deadline).
 *  - FALCON GRENADE LAUNCHER: NO file — the registry gives it the rockets of the
 *    Rockethog, the game plays the SAME event (18 identical media, SONS probe of 2026-09-24).
 *  - Far variants A-E: NOT retained (decision of 2026-09-24), not delivered.
 *
 * THE VEHICLE SHOTS ARE SOUND EFFECTS LIKE THE OTHER WEAPONS: category `weapon` of
 * the drawer, voice ceiling of the player, family `sfx` at the export — nothing to do with the engine bus.
 */

/**
 * VEHICLE_SHOT_SOUND_VARIANTS — the two takes of each weapon, merged in
 * `SOUND_VARIANTS` (replaySoundVariants.ts) so that `soundEvent` attaches them and
 * `pickVariantStem` draws at each shot — the SAME mechanics as the grapple. Table named here
 * (and not inline there) because the assets guardrail needs to recognize it: these
 * variants follow the duration rule of WEAPONS (1.2 s), not that of the equipment.
 */
export const VEHICLE_SHOT_SOUND_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  vehicle_shot_ghost_1: ['vehicle_shot_ghost_1', 'vehicle_shot_ghost_2'],
  vehicle_shot_banshee_m2_1: ['vehicle_shot_banshee_m2_1', 'vehicle_shot_banshee_m2_2'],
  // Banshee M1: _1 = 3rd person take (spectator view), _2 = cockpit view — cf. header.
  vehicle_shot_banshee_m1_1: ['vehicle_shot_banshee_m1_1', 'vehicle_shot_banshee_m1_2'],
  vehicle_shot_wraith_1: ['vehicle_shot_wraith_1', 'vehicle_shot_wraith_2'],
  vehicle_shot_chopper_1: ['vehicle_shot_chopper_1', 'vehicle_shot_chopper_2'],
  vehicle_shot_scorpion_1: ['vehicle_shot_scorpion_1', 'vehicle_shot_scorpion_2'],
  vehicle_shot_warthog_rocket_1: [
    'vehicle_shot_warthog_rocket_1',
    'vehicle_shot_warthog_rocket_2',
  ],
  vehicle_shot_wasp_1: ['vehicle_shot_wasp_1', 'vehicle_shot_wasp_2'],
  vehicle_shot_gungoose_1: ['vehicle_shot_gungoose_1', 'vehicle_shot_gungoose_2'],
  vehicle_shot_falcon_lmg_1: ['vehicle_shot_falcon_lmg_1', 'vehicle_shot_falcon_lmg_2'],
  // LMG of the Wasp: the two takes of the ISOLATED SHOT, the tail of a burst (cf. header).
  vehicle_shot_wasp_lmg_1: ['vehicle_shot_wasp_lmg_1', 'vehicle_shot_wasp_lmg_2'],
}

/**
 * VEHICLE_SHOT_LOOPS — THE HELD-SHOT LOOPS delivered, keyed by the FIRST variant of the SHOT of
 * their weapon (lot M6.1, wiring at lot M4b, schema 71). The title registry publishes the loop of a
 * weapon (`vehicleWeapons[w].loop`); this table is the MANIFEST of the loops that the client knows
 * how to hold — a loop absent here stays silent rather than playing an unverified file, and the shot
 * is then replayed at the rate (`fireBurstSound.ts`). The assets guardrail verifies their format,
 * their duration (beyond the weapons cut, under the safety ceiling) and their declared shot.
 */
export const VEHICLE_SHOT_LOOPS: Readonly<Record<string, string>> = {
  vehicle_shot_wasp_lmg_1: 'vehicle_shot_wasp_lmg_loop',
}
