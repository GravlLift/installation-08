// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * skullSound.ts — THE SOUNDS OF THE ODDBALL SKULL, and the two channels that date them.
 *
 * WHY A SEPARATE FILE, the same reason as `zoneSound.ts`: the source is not `doc.objectives`.
 * The statborg naming (`objectiveevents/named.go`) only carries `ObjectiveTypeFlag`,
 * `ObjectiveTypeZone` and `ObjectiveTypeVip` — `ObjectiveTypeSkull` exists as a constant without
 * a placements table, so NO Oddball statistic arrives in `doc.objectives`. These sounds are
 * dated on `doc.skullCarries` (schema 23, the CARRY PERIODS), on `doc.objectiveObjects` (the
 * LIVES of the free skull) and on `doc.scoreTimeline`.
 *
 * This is what changed since the RE of 2026-08-27 (the seven sounds were valid, the wiring was
 * not yet): at the time the sound engine only read `doc.objectives` and the verdict was "not
 * wireable". Schema 23 opened the channel, and `zoneSound.ts` established the precedent of a
 * sound that comes from no statistic.
 *
 * WHERE THESE SOUNDS COME FROM. Bank `b0c651ea` = `sb_004_mod_mp_oddball` (28 events, 53 sounds),
 * found on 2026-08-27 by FNV-1 hashing of the file name and never inventoried before. The
 * event names are BROKEN, not designated by ear:
 *
 *   play_004_mod_mp_oddball_skull_spawn     event f1dbd79a   1 sound       5.47 s
 *   play_004_mod_mp_oddball_skull_despawn   event fab3a00d   1 of 2        1.71 s
 *   play_004_mod_mp_oddball_skull_taken     event db39b4c6   1 of 2        2.72 s
 *   play_004_mod_mp_oddball_skull_pickup    event f8b484a1   1 of 2        2.26 s  (-5 dB)
 *   play_004_mod_mp_oddball_skull_dropped   event 4a27941d   1 of 3        2.87 s
 *   play_004_mod_mp_oddball_scoring_team    event 60468d1a   2 layers      3.62 s
 *   play_004_mod_mp_oddball_scoring_enemy   event b72c33bf   2 layers      4.36 s
 *
 * The render was redone locally from the game module, and the durations obtained replay those of
 * the board to the hundredth — that is the control that validates the event -> `.wem` mapping.
 *
 * ## THE MARK: the sound ALREADY EXISTS in the tree, under another name
 *
 * MEASUREMENT OF 2026-08-29, and it has a negative witness. The two layers of `scoring_team`
 * carry the `.wem` 578850042 (1.81 s, played twice back to back = the announced 3.62 s) and
 * those of `scoring_enemy` the `.wem` 444143858 (2.18 s x2 = 4.36 s). Compared to the files
 * ALREADY DELIVERED `objective_zone_tick_team` / `_enemy`, their envelopes correlate at
 * **+1.000** exactly, where two unrelated sounds of the same family correlate at +0.66 / +0.69.
 *
 * It is THE SAME SOUND, declared once per game mode — exactly what the RE had already noted for
 * zone capture ("the same sound declared once per mode"). So NO additional file is delivered:
 * these two gestures point to the existing stems. And the treatment of these files fits right
 * here without changing anything — they are truncated at 1.2 s with a fade and attenuated to
 * -12 dBTP because the Bastion tick sounds ONCE PER SECOND. In Oddball we score 1 point per
 * second of carry: same rate, same need.
 *
 * ## APPEARANCE AND DISAPPEARANCE: an ASSUMED approximation, and bounded by construction
 *
 * USER PRODUCT RULE (2026-08-29): "it's when it appears on its pedestal or ends up out of the
 * map. It's not finalized as events yet but maybe you can do as if for the sound?" These two
 * gestures are therefore NOT measured — they are approximated, with the user's explicit
 * agreement, and the doctrine is to say it here rather than let it look like a measurement.
 *
 * THE APPROXIMATION RESTS ON THE GROUND TRUTH of `d9781168`: "2:48 dies jumping into the void
 * with the skull -> cooldown -> pedestal respawn 2:53". The skull out of the map does not fall
 * to the ground: it DISAPPEARS, then REAPPEARS on its pedestal. Hence:
 *
 *   OUT OF MAP a carry period that closes WITHOUT any life opening behind it. A normal drop,
 *             by contrast, reopens a life (the skull rolls on the ground) — the two cases are
 *             EXCLUSIVE, and that is what avoids sounding the fall and the disappearance at the
 *             same moment.
 *   PEDESTAL   the first life of the film, then the first life that follows each disappearance.
 *
 * WHAT BOUNDS THE COUNT, and that is the important point: the appearance is NOT placed on
 * "every start of life". We still do not know how many lives an Oddball film publishes, and a
 * life per bounce would make a 5.47 s fanfare sound at each bounce. By chaining it to the
 * disappearances, the number of appearances is AT MOST 1 + the number of disappearances — a
 * quantity that cannot run away, whatever the real granularity of the lives.
 *
 * ## The side, and what stays silent without it
 *
 * The five skull gestures have NO team variant in the game: the bank carries neither `_team`
 * nor `_enemy` on these events, unlike the flag captures. They therefore sound the same for
 * everyone, side known or not — and that is a measurement on the bank, not a shortcut. THE
 * MARK, by contrast, has its two sides: without a resolved allied side (the film does not place
 * the viewed player), it STAYS SILENT — same rule as everywhere in the sound chain.
 */
import type {
  ReplayDocumentReady,
  ReplayObjectiveObjectReady,
  ReplaySkullCarry,
} from '../../../lib/replay/replayNormalize'
import { frameToMs } from '../../../lib/replay/replayLogic'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import { scoreTimelineOf } from '@/lib/replay/scoreTimeline'

/**
 * SKULL_SOUND_STEMS — the files, by gesture.
 *
 * MANIFEST just like the tables of `replaySound.ts` — the guardrail
 * `replaySoundAssets.guard.test.ts` replays it against the assets folder, in BOTH directions.
 *
 * `scoringTeam` / `scoringEnemy` POINT TO THE ZONE STEMS, and that is not a fallback: the
 * measurement above establishes that it is the same file (correlation +1.000). The name carries
 * "zone" because that is where the sound was identified first; it actually designates the
 * SCORE TICK, that Bastion and Oddball each declare on their own side.
 */
export const SKULL_SOUND_STEMS = {
  /** Skull REAPPEARING on its pedestal. Render of event `f1dbd79a`, a single file. */
  spawn: 'objective_skull_spawn',
  /** Skull OUT OF MAP: it disappears instead of falling. Event `fab3a00d`, 2 variants. */
  despawn: 'objective_skull_despawn',
  /** Skull TAKEN from its pedestal (it was resting there). Render of event `db39b4c6`, 2 variants. */
  taken: 'objective_skull_taken',
  /** Skull PICKED UP from the ground. Render of event `f8b484a1` at -5 dB, 2 variants. */
  pickup: 'objective_skull_pickup',
  /** Skull DROPPED: the carrier dies or sets it down, and the skull rolls on the ground. Event `4a27941d`. */
  dropped: 'objective_skull_dropped',
  /** Score ticket, my team. SAME FILE as the Bastion tick (cf. the header). */
  scoringTeam: 'objective_zone_tick_team',
  /** Score ticket, the opponent. SAME FILE as the Bastion tick. */
  scoringEnemy: 'objective_zone_tick_enemy',
} as const

/**
 * TOLERANCE_FRAMES — the admitted gap between the end of a life and the pickup it precedes, to
 * recognize "the carrier arrives ON the resting skull". Same order of magnitude as the
 * tolerance of `zoneSound.ts`, and same reason: the published series are THINNED, so the
 * last point of a life precedes the flip by a few frames.
 */
const TOLERANCE_FRAMES = 12

/**
 * RETOMBEE_FRAMES — the window in which a life must open after a drop for that drop to be a
 * FALL TO THE GROUND. Beyond it, the skull did not fall back: it went out of the map. The
 * ground truth gives the order of magnitude on the other side (5 s between the death in the
 * void and the respawn on the pedestal); a second is more than enough to cover a real fall
 * back.
 */
const RETOMBEE_FRAMES = 60

/**
 * isAtRest — does the life designate a skull AT REST? `t0 === t1`: a single instant emitted,
 * what `skullPresence.ts` established as the signature of the pedestal.
 */
function isAtRest(vie: ReplayObjectiveObjectReady): boolean {
  return vie.t0 === vie.t1
}

/**
 * pickupOnRest says whether the pickup `t0` immediately follows a skull at rest. It looks for
 * the life with the largest `t1` that ends before the pickup, and only answers true if that
 * life is a rest AND that it touches the pickup within the tolerance — a rest ten seconds old
 * does not describe the pickup in progress.
 */
function pickupOnRest(lives: readonly ReplayObjectiveObjectReady[], t0: number): boolean {
  let derniere: ReplayObjectiveObjectReady | undefined
  for (const vie of lives) {
    if (vie.t1 > t0) continue
    if (!derniere || vie.t1 > derniere.t1) derniere = vie
  }
  if (!derniere) return false
  return isAtRest(derniere) && t0 - derniere.t1 <= TOLERANCE_FRAMES
}

/**
 * fallsBackAfter says whether a life opens in the window that follows a drop — that is, whether
 * the skull fell back to the ground.
 *
 * AN ARTIFACT WITHOUT ANY LIFE ANSWERS TRUE, and this degradation is the heart of the function:
 * "no life after the drop" and "no life at all" are not the same thing. The second case is an
 * artifact that does not publish `objectiveObjects` — there we know NOTHING of the skull's
 * trajectory, and concluding a map exit would be asserting the exceptional from an absence of
 * data. Without information, the replay plays the ORDINARY gesture.
 */
function fallsBackAfter(lives: readonly ReplayObjectiveObjectReady[], t1: number): boolean {
  if (lives.length === 0) return true
  return lives.some((v) => v.t0 >= t1 && v.t0 - t1 <= RETOMBEE_FRAMES)
}

/**
 * firstLifeAfter returns the moment of the first life that opens strictly after `t`, or
 * `undefined`. This is the REAPPEARANCE of the skull on its pedestal.
 */
function firstLifeAfter(
  lives: readonly ReplayObjectiveObjectReady[],
  t: number,
): number | undefined {
  let best: number | undefined
  for (const v of lives) {
    if (v.t0 > t && (best === undefined || v.t0 < best)) best = v.t0
  }
  return best
}

/** The side of a score ticket, seen from the page — same notion as in `objectiveSound.ts`. */
type MarqueSide = 'ally' | 'enemy'

/**
 * scoreTickets — one event per SCORE STEP, in the side of the team that scores.
 *
 * THIS IS THE MECHANISM OF THE DISPLAY ABOVE THE CANVAS, and not a second computation: the
 * film does not transmit a sampled score but its CHANGES (`scoreTimeline.ts`: "a series is a
 * sequence of STEPS — {t, v} means from frame t the value is v"). Each rising step IS a score
 * ticket, the very one that the banner reads. We read `total` and not `rounds[]`: the quantity
 * that restarts from zero at each round would make a reset pass for a score.
 *
 * WITHOUT AN ALLIED SIDE, NOTHING SOUNDS: playing one of the two sides would be asserting a
 * side.
 */
function scoreTickets(doc: ReplayDocumentReady, allyTeam: number | null): ReplaySoundEvent[] {
  if (allyTeam === null) return []
  const timeline = scoreTimelineOf(doc)
  if (!timeline) return []
  const out: ReplaySoundEvent[] = []
  for (const team of timeline.teams) {
    const cote: MarqueSide = team.teamId === allyTeam ? 'ally' : 'enemy'
    const stem = cote === 'ally' ? SKULL_SOUND_STEMS.scoringTeam : SKULL_SOUND_STEMS.scoringEnemy
    let precedent: number | undefined
    for (const p of team.total) {
      if (precedent !== undefined && p.v > precedent) out.push(soundEvent(frameToMs(p.t, doc), stem))
      precedent = p.v
    }
  }
  return out
}

/**
 * skullSoundEvents — the sounds of the skull, placed on the replay clock.
 *
 * THE CLOCK DOES NOT REQUIRE ANY REALIGNMENT: `t0` and `t1` of a carry period are already
 * image indexes, on the same axis as the shots and the positions. The conversion is the same
 * `frameToMs` as everywhere.
 *
 * THE ENTRY GATE IS `skullCarries`: without a carry period, the film is not an Oddball and
 * NOTHING sounds — including the score tickets, which otherwise would be triggered on the
 * steps of any mode.
 *
 * AN UNCLOSED PERIOD DROPS NOTHING. `closed: false` signals a carry that the FILM interrupts
 * (end of match, end of recording): no one dropped the skull, and the replay plays neither the
 * fall nor the disappearance. Sounding the end of the recording would be inventing an action
 * that the match did not have.
 */
export function skullSoundEvents(
  doc: ReplayDocumentReady,
  allyTeam: number | null = null,
): ReplaySoundEvent[] {
  const carries: readonly ReplaySkullCarry[] = doc.skullCarries ?? []
  if (carries.length === 0) return []
  const lives = doc.objectiveObjects ?? []
  const out: ReplaySoundEvent[] = []

  // THE APPEARANCES ARE A SET OF MOMENTS, not a sequence of `push`: the opening appearance
  // and the one that follows a disappearance DESIGNATE THE SAME LIFE when the skull goes out
  // of the map before ever touching the ground. Two `push` would make two 5.47 s fanfares
  // sound at the same moment; the set merges them, which is exactly the intended meaning.
  const apparitions = new Set<number>()
  const ouverture = firstLifeAfter(lives, -1)
  if (ouverture !== undefined) apparitions.add(ouverture)

  for (const c of carries) {
    const prise = pickupOnRest(lives, c.t0) ? SKULL_SOUND_STEMS.taken : SKULL_SOUND_STEMS.pickup
    out.push(soundEvent(frameToMs(c.t0, doc), prise))
    if (!c.closed) continue
    // FALL or OUT OF MAP, never both: the skull fell back to the ground, or it disappeared.
    if (fallsBackAfter(lives, c.t1)) {
      out.push(soundEvent(frameToMs(c.t1, doc), SKULL_SOUND_STEMS.dropped))
      continue
    }
    out.push(soundEvent(frameToMs(c.t1, doc), SKULL_SOUND_STEMS.despawn))
    // ... and the skull REAPPEARS on its pedestal at the next life. This chaining is what
    // bounds the number of appearances (cf. the header).
    const socle = firstLifeAfter(lives, c.t1)
    if (socle !== undefined) apparitions.add(socle)
  }

  for (const t of apparitions) out.push(soundEvent(frameToMs(t, doc), SKULL_SOUND_STEMS.spawn))
  out.push(...scoreTickets(doc, allyTeam))
  return out.sort((a, b) => a.ms - b.ms)
}
