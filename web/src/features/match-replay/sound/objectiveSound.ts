/**
 * objectiveSound.ts — THE OBJECTIVE SOUNDS, and the side that distinguishes them.
 *
 * EXTRACTED FROM `replaySound.ts` ON 2026-08-26, same reason as `grenadeSound.ts`: a family
 * of events that has its own source, its own join key and its own doctrine deserves
 * its file. Here the key is neither a weapon nor a thumbnail: it is the CANONICAL NAME OF
 * STATISTIC that `doc.objectives` publishes.
 *
 * WHERE THESE SOUNDS COME FROM. From the RE of 2026-08-26: the Wwise identifier of a bank is
 * the FNV-1 of its lowercase file name, which allowed NAMING the mode's bank
 * (`sb_004_mod_mp_ctf`), then its events through the same way
 * (`play_004_mod_mp_ctf_flag_scored_team`), then to reconstruct each gesture layer by
 * layer at the gains noted in the format.
 *
 * THE GAME DISTINGUISHES THE TWO SIDES, AND SO DO WE. The event names carry a terminal
 * modulation `_team` / `_enemy`, and those are DISTINCT EVENTS with DIFFERENT
 * files — not the same sound passed through a switch. Six pairs exist in the game;
 * three statistics of the film give access to them.
 */

import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { frameToMs } from '../../../lib/replay/replayLogic'
import { replayClock } from '../model/replayClock'
import { soundEvent, type ReplaySoundEvent } from './replaySoundVariants'
import type { FilmAllegiance } from '../../../lib/replay/filmAllegiance'

/** The side of the author of an action, viewed from the page — the same notion as the feed and the layers. */
export type ObjectiveSide = 'ally' | 'enemy' | 'unknown'

/**
 * OBJECTIVE_SOUND_STEMS — the sound of an objective action, per CANONICAL NAME OF STATISTIC.
 *
 * THE KEY IS THE STATISTIC, NOT A LABEL: `doc.objectives` publishes exactly the names of
 * `match_objective_stats` (`flag_captures`, `flag_grabs`...), and that is the only quantity the
 * film gives for an objective action. A statistic absent from this table is SILENT —
 * never the sound of a neighbor action, same rule as everywhere else in the sound chain.
 *
 * UNKNOWN SIDE = SILENCE on the actions that have two variants. Without film allegiance (the
 * film hides the author's team or that of the viewed player), playing one of the two would
 * assert a side. The replay stays silent rather than choosing — same rule as the layers' ink, which
 * passes to the theme's neutral in this case.
 *
 * `flag_returns` HAS NO TEAM VARIANT IN THE GAME, and that is a measurement, not a
 * shortcut: `play_004_mod_mp_ctf_flag_returned` exists alone, without a `_team`/`_enemy` twin.
 * It therefore sounds the same for everyone, including when the side is unknown.
 *
 * A PAIR CAN BE INCOMPLETE, AND THE TYPE SAYS SO. `zone_captures` today only has its
 * ALLIED side (the opposing sound is not yet designated by ear): the opposing side stays
 * SILENT therefore, exactly like an unknown side. A half-filled pair never plays its
 * other half "for lack of better" — that would be announcing an allied capture on an
 * opposing capture, the worst possible error on an objective sound.
 *
 * WHERE THE ZONE CAPTURE SOUND COMES FROM, AND WHY IT HAS NO NAME. It is DESIGNATED BY
 * EAR by the user (event `d8a2fcb8` of bank `1c609526`, "base captured,
 * allied team"), not broken by hashing — and that is not a stopgap, it is the rule of
 * the work site (`RECETTE_SONS_ARMES` §5: "votes prime over any criterion"). The hashing was
 * pushed to the end on this target: 162 831 744 candidates built on 36 mode names
 * x 4 families x the 141 347 identifiers of the binary x 8 modulations, and only the WITNESS
 * (`c3327c0b` = `..._strongholds_contested`, which the user independently identifies as
 * "contested base") comes out of it. The game binary cannot help either: it carries
 * only THREE Wwise event names in clear text out of the game's ~6 800, because the engine posts
 * its events by PRE-HASHED identifier, never by name.
 *
 * WHAT IS NOT HERE, AND WHY — the inventory is written so we do not redo it:
 *  - `zone_secures`: no designated sound. `zone_captures` has its own, not that one;
 *  - THE BOMB (Assault): THE EVENT HAS EXISTED SINCE 2026-08-31. `ObjectiveTypeBomb` names
 *    `bomb_detonations` and the replay publishes it in `doc.objectives` (26 attributed explosions
 *    out of the 28 dated from the 9-film corpus). What is missing is only the DESIGNATION of the stem by
 *    the user — the sounds are extracted and rendered, but no sound gesture has been designated
 *    for Assault, and designating one in its place would make heard a sound that no one has
 *    approved (rule of the sound gate). A line here, and the explosion sounds;
 *  - THE EXTRACTION DEVICE: its sounds are extracted and rendered, but no
 *    Extraction statistic arrives in `doc.objectives` — the film does not decode this family. This
 *    is not a sound gap, it is an EVENT gap, and that is fixed on the decoder side;
 *  - `flag_capture_assists` and `flag_carriers_killed`: no proper Wwise event in the
 *    mode's bank. Sounding them with the capture sound would make two captures heard.
 */
export const OBJECTIVE_SOUND_STEMS: Readonly<
  Record<string, { ally?: string; enemy?: string } | { any: string }>
> = {
  flag_captures: { ally: 'objective_flag_scored_team', enemy: 'objective_flag_scored_enemy' },
  // THE FLAG TAKEN BY OUR TEAM SOUNDS ONCE (user verdict of 2026-11-02, at
  // the game's listening). The event declares its second layer (alert at +400 ms, +3 dB) repeated
  // three times every 850 ms; the file keeps only one reading, superimposed on the first
  // layer. The opposing side is not affected: its three impulses are IN its media.
  flag_steals: { ally: 'objective_flag_stolen_team', enemy: 'objective_flag_stolen_enemy' },
  flag_grabs: { ally: 'objective_flag_grabbed_team', enemy: 'objective_flag_grabbed_enemy' },
  flag_returns: { any: 'objective_flag_returned' },
  // THE PAIR HAS BEEN COMPLETE SINCE 2026-08-27. It was half empty: only the allied side
  // was designated, and the opposing side stayed SILENT rather than playing the allied sound "for lack of
  // better" — which would have announced a gain when losing a base. The user designated the
  // opposing side at the listening of the board (events `4ebe99d6` / `8594aef7` / `9fad450d` of
  // bank `1c609526`: the same sound declared once per game mode).
  zone_captures: { ally: 'objective_zone_captured_team', enemy: 'objective_zone_captured_enemy' },
  /**
   * THE BOMB EXPLOSION (Assault). Designated by ear by the user on 2026-08-31 on the
   * bank's listening board, and corroborated by its STRUCTURE: the event
   * `984f65e5` (`play_004_mod_mp_assault_bomb_detonated`) declares "1 layer, 1 sound" and points to
   * `538469998` — the two meet on the same file.
   *
   * `{ any }` AND NOT A PAIR, and that is a property of the game, not a shortcut: the
   * Assault bank carries only ONE detonation sound, without a `_team` / `_enemy` twin — exactly like
   * the flag return and the zone contestation. An explosion sounds the same for
   * everyone; it is the RESULT that differs, not the noise.
   *
   * NOTHING TO RECONSTRUCT, unlike the multi-layer gestures of the bank (the countdown
   * stacks two): one layer, one media, vgmstream decoding then peak at -1 dBTP.
   */
  bomb_detonations: { any: 'objective_bomb_detonated' },
}

/**
 * objectiveSoundStem — the file of an objective action, or undefined for silence.
 * Pure, exported to be unit-tested.
 */
export function objectiveSoundStem(stat: string, side: ObjectiveSide): string | undefined {
  const entry = OBJECTIVE_SOUND_STEMS[stat]
  if (!entry) return undefined
  if ('any' in entry) return entry.any
  if (side === 'ally') return entry.ally
  if (side === 'enemy') return entry.enemy
  return undefined
}

/**
 * objectiveSideResolver — THE SIDE OF THE AUTHOR OF AN ACTION, and it is the same source as the
 * layers: its FILM allegiance, viewed from the viewed player (`FilmAllegiance.ofXuid`, 2026-10-06).
 *
 * IT LIVES HERE AND NOT IN THE COMPONENT (rule "no business logic in a component"):
 * `useReplaySound` only has to plug it in. Without allegiance — the film hides the author's team or
 * that of the viewed player, or the author is absent from it — it returns `unknown`: the sound stays silent
 * rather than asserting a side.
 *
 * IT FOLLOWS THE POINT OF VIEW (decision 11 of the plan, 2026-09-06): the objective sounds IN PROGRESS of
 * the match — ally/enemy zone ticks, objective voices — are renders of the current
 * perspective, just like the colors. Only the VERDICT of the end of match remains anchored on the
 * page's player (decision 3, cf. `endMatchSound`).
 */
export function objectiveSideResolver(
  allegiance: Pick<FilmAllegiance, 'ofXuid'>,
): (xuid: string) => ObjectiveSide {
  return (xuid: string): ObjectiveSide => {
    const ally = allegiance.ofXuid(xuid)
    if (ally === null) return 'unknown'
    return ally ? 'ally' : 'enemy'
  }
}

/**
 * objectiveActionClock — the replay moment of an objective action: its exact match time through
 * the page's clock when the film publishes an origin, otherwise its frame (see below). Shared by
 * the objective sounds and the announcer's objective calls, so both land on the same instant.
 */
export function objectiveActionClock(
  doc: ReplayDocumentReady,
): (a: { t: number; timeMs?: number | null }) => number {
  const clock = replayClock(doc)
  return (a) => (clock && a.timeMs != null ? clock.filmMsOfMatchMs(a.timeMs) : frameToMs(a.t, doc))
}

/**
 * objectiveSoundEvents — the objective actions of the document, placed on the replay's clock.
 *
 * THE MOMENT IS THE ONE THE FILM DATES, TO THE MILLISECOND (fixed 2026-09-20). The action
 * carries `timeMs` — the exact moment, on the MATCH axis — in addition to its frame, which is only
 * its FLOOR rounding on the 100 ms grid: the sound therefore systematically arrived early,
 * by 7 to 98 ms on the witness `396cfc92`, never late. The conversion to the frames axis
 * is that of the page, and it is not rewritten here: `replayClock(doc).filmMsOfMatchMs`
 * (single hearth of the film's origin, guardrail `replayClock.guard.test.ts`). Without an established clock
 * — artifact without a published origin —, the frame remains the only dating.
 *
 * AN OBJECTIVE ACTION IS A STATISTIC PER PLAYER, AND THE SOUND IS NOT ONE — that is the
 * second fix of 2026-09-20. `zone_captures` produces an entry per player PRESENT in the
 * zone at the flip: 3 to 4 copies of the same file triggered to the millisecond
 * (measurement on the cache: 48 entries for 29 distinct moments on `396cfc92`, 38 for 16 on
 * `e60aaf06`). That is not "louder", it is a phase beat that distorts the gesture, and
 * it consumes 3 to 4 of the player's 8 voices (`replayAudio.ts`) — which makes DROP the
 * neighbor sounds (shots, kills) at the same moment.
 *
 * THE DEDUPLICATION KEY IS (statistic, moment, side), and each of its three terms
 * counts: two different statistics at the same moment are two gestures; two sides at the
 * same moment are two opposing gestures (a gain and a loss); and the moment, to the millisecond, never
 * merges two actually distinct captures — the shortest base recapture of the corpus is
 * counted in seconds. The rule holds for the WHOLE family, not only for the zone capture:
 * two flags scored at the same millisecond would sound the same beat.
 */
export function objectiveSoundEvents(
  doc: ReplayDocumentReady,
  sideOfXuid?: (xuid: string) => ObjectiveSide,
): ReplaySoundEvent[] {
  const out: ReplaySoundEvent[] = []
  const vus = new Set<string>()
  const msOf = objectiveActionClock(doc)
  for (const a of doc.objectives) {
    const side = sideOfXuid?.(a.xuid) ?? 'unknown'
    const stem = objectiveSoundStem(a.stat, side)
    if (!stem) continue
    const ms = msOf(a)
    const cle = `${a.stat}|${ms}|${side}`
    if (vus.has(cle)) continue
    vus.add(cle)
    out.push(soundEvent(ms, stem))
  }
  return out
}
