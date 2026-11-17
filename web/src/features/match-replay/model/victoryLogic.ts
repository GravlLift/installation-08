// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * victoryLogic — HOW THIS MATCH ENDED FOR THE ONE BEING WATCHED.
 *
 * FOR WHOM, EXACTLY: by default the page player, and since 2026-09-06 the POINT OF VIEW
 * when the caller passes one (plan "frise, point de vue", decisions 3 and 12). The end
 * screen and the video export follow what is being watched; the SOUND and the end voice,
 * for their part, stay anchored on the page player — inspecting an opponent must not
 * play "Defeat" on a won match. The two surfaces therefore share this reading, but pass
 * it a DIFFERENT and explicit subject: see `readVictory`.
 *
 * THE END SCREEN IS YOURS, NOT THE WINNER'S (user amendment of 2026-08-26, in progress of
 * lot). As in the game, the end screen carries the colors and the logo of YOUR team,
 * whether you won or lost — you are not shown the opponent's emblem because it won. This
 * module therefore returns THREE distinct things: the ISSUE (win, loss, tie, from the
 * point of view of the page player), THEIR team (the one that dresses the screen), and
 * the team that WINS (which the screen can name). In a win the two last coincide; in a
 * loss they differ, and that is the whole point of separating them.
 *
 * THE ISSUE IS READ IN THE HEADER, NEVER IN THE SCORE (decision D-B2). The header
 * publishes `outcome_code`, which is the verdict of the PAGE PLAYER (2 = win, 3 = loss,
 * 1 = tie): it is served data, not a deduction. Deducing the winner from the score layer
 * would be wrong at least twice over — a mode without a counter publishes no series, and
 * a match won on the CLOCK can end on a tied score (witness 64e8adfa, 2-2). The header's
 * code knows how to say "won 2-2"; two numbers do not.
 *
 * FROM "MY RESULT" TO "THE TEAM THAT WINS" A BRIDGE IS NEEDED, and the FILM is what makes
 * it (2026-10-06: a player's team is the film's): the film team of the page player gives
 * my camp, and between exactly two camps "I lost" is enough to name the other. When the
 * film does not locate the page player — absent, or its team left unspoken —, the
 * question has no safe answer: `null`, and the screen does not render. This bridge is
 * also what gives the screen its dressing: no known camp, no identity to carry.
 *
 * TWO CAMPS, NOT ONE MORE, NOT ONE LESS (decision D-B1), including for the tie. The same
 * doctrine as the score banner (`scoreBannerLogic.ts`): an FFA has no "winning team" to
 * name, and a three-camp mode would arbitrarily designate an opponent among several.
 * The tie panel, for its part, names no one — but it announces the end of a match
 * OPPOSING TWO CAMPS, and showing it on an FFA would suggest the eight players ended in
 * a tie. An absent reading does not lie, a reading that invents a frame does.
 *
 * THE TIE RETURNS NO TEAM, and that is deliberate: it designates no one (decision D-B1),
 * so the panel stays neutral. Returning `null` for both teams makes this neutrality
 * IMPOSSIBLE TO CIRCUMVENT by accident on screen, rather than entrusting it to a
 * rendering discipline.
 *
 * AN OUT-OF-CONTRACT CODE BUILDS NOTHING. The code→issue mapping is the one of the repo,
 * `lib/outcome.ts` (single source, guard-rail `outcome.guard.test.ts`): an absent, null
 * or out-of-1..4 code returns `null` there. The DNF (code 4) does return an issue, but
 * no end screen: a match left does not conclude (D-B1).
 *
 * PURE module: no React, no DOM, no color, no label.
 */
import { outcomeCodeToValue } from '@/lib/outcome'
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import type { ReplayCamp } from '@/lib/replay/replayCamps'

/**
 * What this module reads from the FILM: the camps of the match (designators, named by
 * the sheet) and the team of a player designated by their base xuid. `FilmAllegiance`
 * conforms to it — the reference it carries is NOT read here: the page player and the
 * subject are passed.
 */
export type VictoryFilm = Pick<FilmAllegiance, 'camps' | 'teamOfXuid'>

/** The issue of the match FOR THE SUBJECT of the reading — the page player in the absence of a point of view. */
export type VictoryOutcome = 'win' | 'loss' | 'tie'

/** A team designated by the reading: enough to name it, tint it and dress it. */
export interface VictoryTeam {
  /** The film's team designator — key of the logo. */
  teamID: number
  /**
   * The sheet side that NAMES the camp (`ReplayCamp.side`, format `t{N}`) — what the
   * label cascade expects; `null` when none of its members has a row (the label then
   * falls back on the designator's "Team N").
   */
  teamSide: string | null
  /** `true` if it is the team of the SUBJECT (the page player in the absence of a point of view). */
  ally: boolean
}

/** The end-of-match reading: the issue, the team that dresses the screen, the one that wins. */
export interface VictoryReading {
  outcome: VictoryOutcome
  /**
   * THE SUBJECT'S TEAM — the dressing of the screen. `null` on a tie.
   *
   * "Of the page player" until 2026-09-06: that was true as long as `readVictory`
   * guessed its subject. Since it receives it as a parameter, it is the team of THE
   * ONE BEING WATCHED — the page player when no subject is passed, which is what the
   * sound end-of-game always does (decision 3 of the plan).
   */
  mine: VictoryTeam | null
  /** The team that wins the match. `null` on a tie, which designates no one. */
  winner: VictoryTeam | null
}

/**
 * readVictory returns the end-of-match reading, or `null` when no screen should be
 * shown: a match that does not oppose exactly two film camps, an unpublished or
 * out-of-contract result, an abandon, or a page player the film does not locate (cf.
 * the module header).
 *
 * `page`: the base xuid of the page player (`meXUIDOf`) — the one of which
 * `outcomeCode` is the verdict. The module does not look it up itself: it receives
 * it, like the subject.
 *
 * `subject` (2026-09-06, plan "frise, point de vue"): THROUGH WHOSE EYES this ending
 * is read.
 *
 * MIND THE ASYMMETRY OF THE TWO INPUTS, that is the whole subject. `outcomeCode` is
 * the verdict OF THE PAGE PLAYER, served by the header — no other exists, the API does
 * not publish the result seen from an opponent. When `subject` designates someone of
 * the OTHER camp, the reading is therefore turned around: what the page player won,
 * they lost. The page reading is computed, then permuted. Subject of the same camp:
 * rigorously identical. Tie: it is one for everyone, nothing to permute. Subject the
 * film does not locate: `null` — no screen rather than a wrong one.
 *
 * `subject` absent: the page player, original behavior — that is what the SOUND
 * end-of-game passes (decision 3), which stays anchored on it.
 */
export function readVictory(
  film: VictoryFilm,
  outcomeCode: number | null | undefined,
  page: string | null,
  subject?: string | null,
): VictoryReading | null {
  const camps = film.camps
  if (camps.length !== 2) return null
  const outcome = outcomeCodeToValue(outcomeCode)
  if (outcome === 'tie') return { outcome: 'tie', mine: null, winner: null }
  if (outcome !== 'win' && outcome !== 'loss') return null
  const mineIndex = campIndex(camps, film.teamOfXuid(page))
  if (mineIndex === null) return null
  const vu = subjectCampIndex(film, subject, mineIndex)
  if (vu === null) return null
  const won = vu === mineIndex ? outcome === 'win' : outcome === 'loss'
  const mine = camps[vu]
  const winner = won ? mine : camps[1 - vu]
  return {
    outcome: won ? 'win' : 'loss',
    mine: { teamID: mine.team, teamSide: mine.side, ally: true },
    winner: { teamID: winner.team, teamSide: winner.side, ally: won },
  }
}

/**
 * victoryIsFlipped — WAS THE READING TURNED AROUND? (2026-09-07)
 *
 * `true` when the subject is of the camp OPPOSED to that of the page player: what the
 * page won, they lost, and `readVictory` permuted accordingly. `false` everywhere else —
 * no subject, subject of the same camp, subject that cannot be located, match that does
 * not oppose two camps.
 *
 * THIS IS THE PREDICATE OF THE SCORE: `finalScoreFromHeader` calls it to know whether
 * it must swap the two numbers served by the header, which hold for the page player.
 * A single definition of "the other camp", rather than the same triple comparison under
 * a different name.
 *
 * IT SERVED THE VERDICT WORD FOR A WHILE, and no longer does: the end screen and the
 * export panel chose between `header.outcome_label` (the backend's word, valid for the
 * page player) and the canonical label of the permuted issue. Since the two titles
 * come from `outcomes.toml` on the issue READ, there is no longer a branch to open —
 * the word follows the permutation on its own. The score, for its part, has no
 * equivalent: the header's numbers carry no point of view, hence this still living
 * predicate.
 *
 * WHY A FUNCTION AND NOT A FIELD OF `VictoryReading`: adding it to the object would
 * have made the fourteen cases of `victoryLogic.test.ts` red, which pin the reading
 * in its ENTIRETY by deep equality — the characterization only accepts additions, and
 * one more field is not one.
 */
export function victoryIsFlipped(
  film: VictoryFilm,
  page: string | null,
  subject?: string | null,
): boolean {
  if (subject == null) return false
  if (film.camps.length !== 2) return false
  const mien = campIndex(film.camps, film.teamOfXuid(page))
  if (mien === null) return false
  const vu = subjectCampIndex(film, subject, mien)
  return vu !== null && vu !== mien
}

/**
 * subjectCampIndex says in which of the two camps the point of view is, or `null` when
 * the film does not locate it (absent from the film, team unspoken, camp outside the
 * two kept).
 *
 * Without a subject, the answer is the camp of the page player, already computed: it is
 * not looked up twice, and above all it cannot diverge from it.
 */
function subjectCampIndex(
  film: VictoryFilm,
  subject: string | null | undefined,
  defaut: 0 | 1,
): 0 | 1 | null {
  if (subject == null) return defaut
  return campIndex(film.camps, film.teamOfXuid(subject))
}

/**
 * campIndex says WHICH of the two film camps carries this designator (0 or 1), or
 * `null`: unknown team (the film leaves it unspoken), none (`-1`), or outside the two
 * camps.
 */
function campIndex(camps: readonly ReplayCamp[], team: number | null): 0 | 1 | null {
  if (team === null) return null
  if (camps[0].team === team) return 0
  if (camps[1].team === team) return 1
  return null
}

/**
 * The FINAL score of the match, in the order of the SUBJECT: their camp first, the
 * other after. Without a subject, it is the order of the page player — the one in
 * which the API publishes it.
 */
export interface FinalScoreReading {
  ally: number
  enemy: number
}

/** What the end screen reads from the match view header to know the final score. */
export interface FinalScoreHeader {
  score_kind?: string
  score_mine?: number
  score_theirs?: number
}

/**
 * finalScoreFromHeader returns the final score SERVED BY THE API, and `null` when the
 * header does not publish one — in which case the end screen keeps its reading of the
 * film layer.
 *
 * WHY THE API HERE, WHEN ALL THE REST OF THE REPLAY COMES FROM THE FILM. The layer
 * reading at the end bound returns, on a round mode, the points of the LAST ROUND
 * (Oddball: "100 - 43") presented as the score of the match. That is wrong: the match
 * was played in two one-round games. The end screen announces a RESULT, and the result
 * is the one the whole app displays elsewhere — taking it from the header guarantees
 * the two surfaces cannot say two different numbers of the same match.
 *
 * IT MUST NOT BE RESTRICTED TO ROUND READINGS ONLY: when the server publishes
 * `score_kind = "points"` (undeclared variant, single-round match, unknown rounds),
 * filtering on "rounds" would send the end screen back to the layer, hence to the
 * points of the last round, while the match view displays the total. The criterion is
 * therefore the PRESENCE of the two numbers, never their nature.
 *
 * The living pendant — the round dots that fill up during playback — stays derived
 * from the film: it must follow the playback position, which the header cannot do
 * (cf. `roundDots`).
 *
 * # THE SUBJECT, AND WHY IT HAD TO BE ADDED (2026-09-07, lot L3)
 *
 * `score_mine` / `score_theirs` are ANCHORED ON THE PAGE PLAYER — the API does not
 * publish the score seen from an opponent, exactly as it publishes only one
 * `outcome_code`. As long as the page had a single point of view, the order was right
 * by construction. Since L2b it is no longer: `ReplayVictoryOverlay` gives this
 * reading PRIORITY over that of the layer (`readScoreBanner`), which, for its part,
 * follows the point of view. Seen from an opponent, the screen therefore announced the
 * permuted issue (`readVictory` does it) and the score in the order of the page
 * player: "Defeat, 3 - 1". Wrong, in full frame, and perfectly silent.
 *
 * The rule is that of `readVictory`: subject of the OTHER camp, permute. Subject of
 * the same camp, rigorously identical.
 *
 * SUBJECT THAT CANNOT BE LOCATED (that the film places in none of the two camps, match
 * that does not oppose exactly two camps): the order of the PAGE PLAYER is returned,
 * not `null`. Two reasons. First there is nothing to permute — without a camp, "the
 * other camp" does not exist, and the API's order is the only sense these two numbers
 * have. Then no wrong score can reach the screen by this path: the only two surfaces
 * that display it (the end screen and the export panel) render only on the condition
 * that `readVictory` returns a reading — and it returns `null` in exactly the same
 * cases. Returning `null` here would therefore erase nothing visible, but would deprive
 * a future reader of a score the API does in fact publish.
 *
 * `subject` absent: original behavior, to the line (cf. `victoryLogic.test.ts`).
 */
export function finalScoreFromHeader(
  header: FinalScoreHeader | undefined,
  film?: VictoryFilm,
  page?: string | null,
  subject?: string | null,
): FinalScoreReading | null {
  if (!header || header.score_mine == null || header.score_theirs == null) return null
  const parLaPage = { ally: header.score_mine, enemy: header.score_theirs }
  if (!film) return parLaPage
  // SAME DEFINITION OF "THE OTHER CAMP" AS THE ISSUE (2026-09-07): this test was
  // written here as four guards, copied from `readVictory`. They now live in
  // `victoryIsFlipped`, which the end screen also calls to choose its WORD — the three
  // can no longer diverge.
  return victoryIsFlipped(film, page ?? null, subject)
    ? { ally: parLaPage.enemy, enemy: parLaPage.ally }
    : parLaPage
}
