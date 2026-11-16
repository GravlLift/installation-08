/**
 * grenadeSound.ts — THE TWO SOUNDS OF THE SAME OBJECT: the GESTURE of the throw, and the DETONATION.
 *
 * EXTRACTED FROM `replaySound.ts` ON 2026-08-18 (lot R2-G): this file was born when
 * the explosion stopped being a line of the manifest to become a rule — a dating,
 * a deduplication, and a silence to hold. The general manifest, the categories and
 * the assembly of the track remain with the neighbor; here lives everything specific to the
 * grenade, doctrine included. The guardrail `replaySoundAssets.guard.test.ts` replays the
 * two tables below against the assets folder, like the others.
 *
 * THE EXPLOSION SOUNDS AT EVERY END OF FLIGHT, NO LONGER ONLY ON A KILL — user decision
 * of 2026-08-18, word for word: "whether it kills or not, they explode so the
 * sound must be played". That is the answer to gripe D2 ("the throws are played but I don't get the
 * explosions"), whose cause lot R2-S had measured: the explosion had only ONE source,
 * the thumbnail of a grenade kill — 16 explosions for 343 throws on the three witnesses,
 * and ZERO on 00162144 which nonetheless carries 143. It was not a masking, it was an
 * absence. THE THROWS REMAIN: decision 4 of the R2 plan would have removed them if the explosion
 * covered them more than one time in two — 31.3% measured on the real track, 48.6% on
 * the paired flight endings, below the threshold both ways (test S2, replaySound.test.ts).
 *
 * THE DATING IS THE SCREEN'S, AND THERE IS ONLY ONE: the moment comes from
 * `buildGrenadeRestFx` (grenadeFx.ts), the function that ALREADY places the visual effect of the
 * flight end — the last replicated step of the projectile linked to the throw. Writing a second rule here
 * would make the explosion sound next to its image the day one of the two moved.
 * Assumed consequence, which is heard: this point is the LAST KNOWN POSITION, not an
 * impact — for a frag the replication stops ~1.4 s before the fuse end, and the sound is
 * therefore ahead of the real detonation, exactly like the effect on screen. A grenade
 * whose film links NO projectile only sounds its throw: nothing dates its end.
 *
 * THE DYNAMO SOUNDS, EVEN IF THE SCREEN DOES NOT MAKE IT DETONATE. `restKindOf` gives it a
 * persistent electric sheet rather than a blast, because that is what the weapon does in
 * the game; but the discharge IS HEARD, the pack carries `explosion_dynamo`, it was already sounding on
 * a Dynamo kill, and the 18/08 decision makes no exception of type. The screen and the
 * track say the same thing in two ways.
 *
 * A GRENADE KILL DOES NOT SOUND TWICE. The two sources then speak of the same object:
 * the kill's thumbnail, and the end of flight of the projectile. When they fall within
 * `GRENADE_EXPLOSION_DEDUP_MS` of each other WITH THE SAME TYPE, it is a single detonation
 * heard twice — we keep the KILL and remove the flight end. Why the kill: it is
 * dated by `alignFeed`, the clock that already dates the card flash and the death effect, and
 * it is the sound the user approved on 16/08. The pairing is ONE TO ONE: a kill
 * cancels only ONE flight end, otherwise two grenades of the same type thrown together
 * would both disappear behind a single kill.
 *
 * No React, no Web Audio: pure logic, tested (replaySound.test.ts).
 */
import { buildRestFx } from '../model/shotImpactFx'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import type { ReplaySoundEvent } from './replaySound'
import { buildLivesBySlot, lifeOfSlotAt } from '../model/livesPosition'

/**
 * THROW sound per grenade rank (the index IS the rank, same rule as grenadeLabels:
 * 0 Frag, 1 Plasma, 2 Dynamo, 3 Spike — replay_labels.toml). A rank out of the table = silence.
 */
export const THROW_SOUND_STEMS: readonly string[] = [
  'throw_frag',
  'throw_plasma',
  'throw_dynamo',
  'throw_spike',
]

/**
 * EXPLOSION sound per grenade rank — SAME INDEX as THROW_SOUND_STEMS, because it is the
 * same object in its two forms. A rank out of the table = silence: the type is not established.
 *
 * THE FOUR STEMS ARE ALSO IN `KILL_SPRITE_SOUND_STEMS`, AND THAT IS NOT AN EXTRA COPY:
 * the two tables do not join by the same quantity — this one by the RANK that
 * the film publishes with the throw (what was THROWN), the other by the THUMBNAIL that the backend
 * publishes with the kill (what KILLED). Merging them would require translating one into the other at
 * every read, while nothing guarantees that the two chains will keep the same order.
 * The guardrail `replaySoundAssets.guard.test.ts` replays precisely this equality (rank N
 * <-> killfeed-46+N): the day one moved, the other would become wrong IN SILENCE.
 */
export const EXPLOSION_SOUND_STEMS: readonly string[] = [
  'explosion_frag',
  'explosion_plasma',
  'explosion_dynamo',
  'explosion_spike',
]

/**
 * Gap below which a flight-end explosion and a grenade kill OF THE SAME TYPE are
 * the same detonation heard twice (deduplication, decision of 2026-08-18).
 *
 * 0.3 s is the window of DECISION 4 of the R2 plan, the one already serving to judge whether a
 * throw was masking its explosion: placing a second one for the same question would make two
 * thresholds to hold. It is wide compared to the measured gap between the two clocks (the feed is
 * re-aligned to ±150 ms of its median, cf. KILL_MATCH_TOL_MS) and short compared to the delay that
 * separates two grenades from the same player.
 */
export const GRENADE_EXPLOSION_DEDUP_MS = 300


/**
 * grenadeSoundEvents — THE TWO SOUNDS OF THE SAME OBJECT: the GESTURE of each throw, on the
 * throw's frame, and the EXPLOSION of each flight end, on the frame that `buildGrenadeRestFx` has already
 * computed for the screen. A rank out of the four known types returns neither.
 *
 * `killExplosions` carries the explosions THAT THE KILLS HAVE ALREADY SCHEDULED, in the order in which
 * they were scheduled. A flight end that falls on one of them — same type, less than
 * `GRENADE_EXPLOSION_DEDUP_MS` of gap — is the same detonation: we remove it, and we MARK
 * the kill as consumed so it does not cancel a second one.
 */
export function grenadeSoundEvents(
  doc: ReplayDocumentReady,
  killExplosions: readonly ReplaySoundEvent[],
  // The followed player's own THROW stays without a place — same reasoning as a shot's
  // muzzle, heard from the hand that makes it. The EXPLOSION, by contrast, always keeps its
  // place: it lands at the end of flight, a world point away from the thrower, never "inside"
  // him — a grenade he threw still detonates somewhere else, and that stays spatial for him too.
  followed: string | null = null,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  const lives = buildLivesBySlot(doc.tracks)
  for (const g of doc.grenades) {
    const stem = THROW_SOUND_STEMS[g.rank ?? -1]
    if (!stem) continue
    const own = followed !== null && lifeOfSlotAt(lives, g.slot, g.t)?.xuid === followed
    out.push(own ? { ms: frameToMs(g.t, doc), stem } : { ms: frameToMs(g.t, doc), stem, at: { x: g.x, y: g.y } })
  }
  const consommes = new Set<number>()
  for (const fx of buildRestFx(doc)) {
    // A shot projectile (`tint` set) sounds through its WEAPON, a grenade through its rank: never the
    // sound of one for the other.
    const stem = fx.tint === undefined ? EXPLOSION_SOUND_STEMS[fx.rank] : fx.impactStem
    if (!stem) continue
    const ms = frameToMs(fx.frame, doc)
    const jumeau = killExplosions.findIndex(
      (k, i) =>
        !consommes.has(i) &&
        k.stem === stem &&
        Math.abs(k.ms - ms) < GRENADE_EXPLOSION_DEDUP_MS,
    )
    if (jumeau >= 0) consommes.add(jumeau)
    else out.push({ ms, stem, at: { x: fx.x, y: fx.y } })
  }
  return out
}
