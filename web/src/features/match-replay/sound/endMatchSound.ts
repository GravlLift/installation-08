/**
 * endMatchSound.ts — WHAT SOUNDS WHEN THE MATCH ENDS: the announcer's voice and the
 * fanfare, together, once.
 *
 * A FILE OF ITS OWN, ON THE MODEL OF `grenadeSound.ts` (lot R2-G): the general manifest
 * (`replaySound.ts`) carries what sounds DURING the match, event by event, on
 * the film's clock. The end of match is not a film event — it is the CONCLUSION,
 * it is not dated, it is triggered when playback reaches the end bound
 * (`useReplayPlayback`), and it depends on two quantities nothing else in the sound
 * looks at: the OUTCOME of the page's player and the LANGUAGE of the interface. The neighbor
 * is also at its size ceiling.
 *
 * FIRST LOCALE-AWARE ENTRY OF THE SOUND CATALOG. A shot, an explosion, a placement have no
 * language; an ANNOUNCER'S VOICE has one. The two packs (FR and EN) are extracted from the game,
 * and the language played is the one of the INTERFACE (the `locale` prop of the replay page) —
 * not the game's language at the time of the match, which the film does not publish.
 *
 * TWO SOUNDS GO OUT TOGETHER, AND THAT IS THE GAME'S STAGING (user decision of
 * 2026-08-27): the announcer's line on top of the fanfare. They are two voices of
 * the player, never a pre-mixed file — the user keeps their volume, and a re-delivery
 * of one of the two does not require re-mixing the other.
 *
 * MULTIPLE TAKES, RANDOM DRAW (vote rule: "multiple takes -> random draw").
 * The randomness is INJECTED (`rand`), like everywhere else in the replay sound (pattern
 * `drawVariation` / `weaponSoundVariations.ts`): tests pin the take, production
 * passes `Math.random`. FR has two takes for win, loss and tie; EN
 * has only one for win and tie — the EN pack carries two for loss only.
 *
 * FFA HAS NO SCREEN, BUT IT HAS A SOUND (decision D-C3). The end screen requires TWO sides
 * (`victoryLogic.ts`, decision D-B1): on a teamless match it does not render, and that
 * is fair — it would announce a confrontation that did not take place. A VOICE, it, has no
 * such problem: "Winner" names no one. A WON FFA therefore sounds, with the
 * victory fanfare; a lost FFA and an FFA tie stay silent, lacking a line that says
 * that without naming a team.
 *
 * THE FALLBACK TO ENGLISH IS DOCUMENTED, NOT SILENT: the EN announcer pack carries no
 * standalone "Winner" (noted at the 2026-08-27 transcription, `vote_fin_partie.json`:
 * `winner_ffa: "A_IDENTIFIER"`). A won FFA in English therefore plays "Victory", which is true
 * — the user did indeed win — instead of staying silent on the only language.
 *
 * THE OUTCOME COMES FROM THE SAME READING AS THE SCREEN, and there is only one: `readVictory`
 * (`victoryLogic.ts`) for two-side matches, `outcomeCodeToValue` (`lib/outcome.ts`,
 * the single source of truth of the repo) for the rest. Re-decoding `outcome_code` here would make two truths,
 * and the day one of them moved the screen would announce a victory while the sound sounded
 * a defeat.
 *
 * No React, no Web Audio: pure logic, tested (endMatchSound.test.ts). The wiring
 * lives in `useReplaySound`, the playback in `replayAudio.ts`. The guardrail
 * `replaySoundAssets.guard.test.ts` replays the three tables below against the assets
 * folder, like the others.
 */
import { meXUIDOf } from '@/features/match-view/xuidMeta'
import type { MatchScoreboardRow } from '@/lib/api/types'
import { outcomeCodeToValue } from '@/lib/outcome'

import type { ReplayLocale } from '../i18n/i18n'
import { readVictory, type VictoryFilm, type VictoryOutcome } from '../model/victoryLogic'

/**
 * The announcer's voice TAKES, per outcome then per language. A list with multiple entries
 * = multiple recordings of the same word in the game, among which the app draws (cf. the header).
 *
 * Transcriptions noted at extraction (2026-08-27): FR "Victoire" (x2), "Défaite"
 * (x2), "Égalité" / "À égalité"; EN "Victory", "Defeat" (x2), "Game tied".
 */
export const END_VOICE_STEMS: Readonly<
  Record<VictoryOutcome, Readonly<Record<ReplayLocale, readonly string[]>>>
> = {
  win: {
    fr: ['end_victory_voice_fr_01', 'end_victory_voice_fr_02'],
    en: ['end_victory_voice_en_01'],
  },
  loss: {
    fr: ['end_defeat_voice_fr_01', 'end_defeat_voice_fr_02'],
    en: ['end_defeat_voice_en_01', 'end_defeat_voice_en_02'],
  },
  tie: {
    fr: ['end_tie_voice_fr_01', 'end_tie_voice_fr_02'],
    en: ['end_tie_voice_en_01'],
  },
}

/**
 * The FANFARE per outcome — one per outcome, and without language: music does not speak.
 * They are delivered at -18 LUFS while the voices are at -16 (user decision of
 * 2026-08-27, "audible without shouting"): the line must pass OVER the fanfare,
 * that 2 LU gap puts it there, not a player setting.
 */
export const END_MUSIC_STEMS: Readonly<Record<VictoryOutcome, string>> = {
  win: 'end_victory_music_01',
  loss: 'end_defeat_music_01',
  tie: 'end_tie_music_01',
}

/**
 * The voice of the WON FFA, per language — "Vainqueur" (Winner), the line that names no team.
 * English falls back to "Victory": the EN pack has no standalone "Winner" (cf. the header).
 */
export const END_FFA_WIN_VOICE_STEMS: Readonly<Record<ReplayLocale, readonly string[]>> = {
  fr: ['end_winner_voice_fr_01'],
  en: ['end_victory_voice_en_01'],
}

/**
 * What needs to be known about a match to conclude it in sound: the OUTCOME OF THE PAGE'S
 * PLAYER, the interface language, and whether the match opposed two identified sides.
 */
export interface EndMatchSoundSpec {
  outcome: VictoryOutcome
  /**
   * `true` = the match does NOT oppose two identified sides — FFA, more than two sides, or a
   * page player the film does not place. The name comes from the case that populates it in
   * practice; what the flag really says is "no team to name", and the voice chosen
   * ("Vainqueur" / Winner) is precisely the one that names none.
   */
  ffa: boolean
  locale: ReplayLocale
}

/**
 * endMatchSoundSpec reads the end of a match from the SOUND's point of view, relying on the
 * screen's reading (`readVictory`) — never on a second decoding of `outcome_code`.
 *
 * `null` = nothing sounds: match not concluded (header not yet loaded, code out of contract),
 * surrender, or a teamless end the voice could not announce (lost FFA or tie).
 *
 * IT HAS NO SUBJECT, AND THAT IS INTENTIONAL (decision 3 of the "timeline, point of view" plan, 2026-09-06).
 * `readVictory` accepts a subject — through whose eyes the end is read — and the end screen, it, passes
 * the POINT OF VIEW there; here the subject is omitted: the end is read for the PAGE'S PLAYER, whom
 * this function itself finds in the scoreboard (`meXUIDOf`) — the caller can therefore not slip in
 * the point of view — and whose team is read in the film like everywhere else.
 * Inspecting an opponent must not make "Défaite" (Defeat) ring out on a match that was won. The
 * two calls therefore intentionally diverge. Do not "harmonize": also see the comment on the
 * route, at the `endMatchSoundSpec` call. `film` serves only its sides and a
 * player's team: the reference that the allegiance carries (the point of view) is not read.
 */
export function endMatchSoundSpec(
  film: VictoryFilm,
  scoreboard: readonly Pick<MatchScoreboardRow, 'xuid' | 'is_me'>[],
  outcomeCode: number | null | undefined,
  locale: ReplayLocale,
): EndMatchSoundSpec | null {
  // NO SUBJECT: the omitted subject stands for "the page's player" (decision 3).
  const reading = readVictory(film, outcomeCode, meXUIDOf(scoreboard))
  if (reading) return { outcome: reading.outcome, ffa: false, locale }
  // Without two readable sides, only the VICTORY has a line: "Vainqueur" (Winner) does
  // without a named opponent, "Défaite" (Defeat) and "Égalité" (Tie) presuppose a two-side confrontation.
  const outcome = outcomeCodeToValue(outcomeCode)
  return outcome === 'win' ? { outcome, ffa: true, locale } : null
}

/**
 * endMatchSounds returns THE FILES TO PLAY TOGETHER at the arrival at match end: the voice
 * drawn among its takes, then the fanfare. Empty list = nothing sounds.
 *
 * `rand` is injected so that tests pin the take; production passes `Math.random`
 * (same pattern as `drawVariation` for the weapons' RANGED ranges).
 */
export function endMatchSounds(
  outcome: VictoryOutcome,
  ffa: boolean,
  locale: ReplayLocale,
  rand: () => number = Math.random,
): string[] {
  if (ffa) {
    if (outcome !== 'win') return []
    return [pickTake(END_FFA_WIN_VOICE_STEMS[locale], rand), END_MUSIC_STEMS.win]
  }
  return [pickTake(END_VOICE_STEMS[outcome][locale], rand), END_MUSIC_STEMS[outcome]]
}

/**
 * endMatchSoundStems returns ALL the takes an end MAY play, draw included — that is what
 * the player must pre-load. Pre-loading only the drawn take would not work: the
 * draw happens at the arrival at end, and a file requested at that moment would arrive late.
 */
export function endMatchSoundStems(spec: EndMatchSoundSpec | null): string[] {
  if (!spec) return []
  if (spec.ffa) {
    return spec.outcome === 'win'
      ? [...END_FFA_WIN_VOICE_STEMS[spec.locale], END_MUSIC_STEMS.win]
      : []
  }
  return [...END_VOICE_STEMS[spec.outcome][spec.locale], END_MUSIC_STEMS[spec.outcome]]
}

/**
 * A random take. The draw is bounded to the valid index: a `rand` that returns
 * exactly 1 (out of `Math.random`'s contract, but not of a test double) would otherwise
 * fall out of the list and play `undefined`.
 */
function pickTake(takes: readonly string[], rand: () => number): string {
  return takes[Math.min(Math.floor(rand() * takes.length), takes.length - 1)]
}
