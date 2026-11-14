/**
 * scoreBannerLogic — WHAT THE SCORE BANNER HAS THE RIGHT TO DISPLAY, at the frame read.
 *
 * The banner holds above the field: `[ ally bar ] — [ clock ] — [ enemy bar ]`.
 * This module returns the READING (two camps, two scores, two fractions, the round); the
 * component turns it into JSX only. The reading bricks at the current frame come from
 * `lib/replay/scoreTimeline.ts`, already proven by the three re-baked witnesses (Slayer 43/50,
 * CTF 3-0, Oddball total 200/121). This file CHOOSES which one to apply: on a
 * round-based mode, the banner displays the CURRENT ROUND (`teamRoundScoreAtFrame`, reset to 0 at each
 * round — e.g. Oddball M1 100/78 then M2 100/43), and not the cumulative of the match. The total 200/121,
 * for its part, remains the quantity of `teamScoreAtFrame` and of the « Score over time » curve of the
 * match view. What the banner, and it alone, must rule: WHAT ARE THE TWO CAMPS, WHICH ONE
 * IS ON THE LEFT, WHICH ROUND IS IN PROGRESS, and HOW FAR THE BAR GOES.
 *
 * THE CAMPS ARE READ FROM THE ROSTER OF THE FILM, NOT FROM THE SCORE LAYER — and it is the trap this
 * module must avoid. A team that has never scored emits NO series at all: the CTF witness
 * `530820e5` (3-0) publishes only one camp out of the two. Counting the camps in
 * `timeline.teams` would therefore make the banner disappear from the match where the gap is the clearest.
 * The camps are the designators that the film writes to its roster (`FilmAllegiance.camps`, the
 * same as the card columns — decision of 2026-10-06: the team is the one of the film), and the
 * score of each comes from `teamScoreAtFrame`, which returns 0 for a camp without series — the truth of the
 * film, not a gap.
 *
 * BUT A FILM THAT PUBLISHES NO SERIES SAYS NOTHING, NOT « 0 — 0 ». Without the
 * slightest camp in the layer (artifact prior to schema 12, mode without counter, clock
 * not rescaled), two bars at zero would be read as a measurement while no one has
 * counted. The banner is then absent — same doctrine as in the column header
 * (`ReplayTeamHeader`).
 *
 * A SERIES WITHOUT A CAMP IS ALSO KEPT SILENT (replay feedback 2026-09-23, lot L1.2). When the film has
 * not been able to say which camp carries a series (`coverage.score.teamIdentity = "unresolved"`), none
 * of the two camps can find it again: the banner displayed « 0 — 0 » for the whole match (7 documents
 * of the park, including fb1a1a72). As soon as a published series has no camp, it is absent.
 *
 * TWO CAMPS, NOT ONE MORE, NOT ONE LESS. The requested shape has only two bars; it
 * can therefore not say a three-camp mode without naming arbitrarily ONE opponent among
 * several, nor a FFA, where each plays for themselves. In these cases the reading is `null` and the
 * banner does not render: an absent bar does not lie, a bar that designates the wrong
 * camp does.
 *
 * « ALLY » IS A RELATIVE NOTION, AND ITS ABSENCE IS DISQUALIFYING HERE. « Ally » means
 * « of the camp of the FILM of the watched player » (`FilmAllegiance.ofTeam`, the same allegiance as the
 * pieces and the columns). When it is not known — watched player absent from the film, or of whom
 * the film keeps the team silent — the banner has NEITHER side NOR color: it does not render. This is
 * the doctrine of the two other panels (« a camp without known allegiance borrows none of the
 * two colors ») pushed to its consequence for a surface whose camp IS the whole
 * structure.
 *
 * THE DENOMINATOR IS THE CEILING OF THE ROUND, NOT THE TARGET OF THE MATCH (user request of
 * 2026-08-24: « full when the match is over because the winning score is reached,
 * that is the denominator »). On a round-based mode, the numerator restarts from zero at each
 * round, so the denominator that accompanies it is that of ONE round (100 for Oddball),
 * constant from round 1 to round N — otherwise the bar would appear half as full at
 * the second. The film does not carry it; it is the artifact that publishes it
 * (`scoreTimeline.targetScore`) from the MEASURED table of the variant
 * (config regulation.toml [score_target], plates of the winner score in the register). A
 * victory ON THE CLOCK is therefore displayed correctly: 43/50, never a full bar at 43.
 *
 * AS A FALLBACK (artifact prior to the field, variant out of table, table
 * expired that the producer killed), the fallback on a round-based mode is the highest last-step of all
 * the rounds (`roundTargetOf`); on a single-round mode, that of the comeback engine
 * (`internal/analysis/comeback.go`): `max(scoreFinalA, scoreFinalB)` — in a game
 * won at the target, the final score of the winner IS the target. In all cases the
 * denominator is CONSTANT over the whole reading: a bar NEVER goes back (the version
 * relative to the camp across at the frame read emptied when the opponent scored — refused
 * by the user). The number written in the bar remains the measurement — it is the one that carries
 * the authority.
 *
 * PURE module: no React, no DOM, no color.
 */
import type { FilmAllegiance } from '@/lib/replay/filmAllegiance'
import {
  teamRoundScoreAtFrame,
  teamScoreAtFrame,
  teamSeriesFor,
  type ReplayScoreTimelineReady,
} from '@/lib/replay/scoreTimeline'

import { currentRoundAtFrame, roundDots, type CurrentRound, type RoundDot } from './roundsLogic'

/**
 * What it takes to know about a camp to draw its bar.
 *
 * `fill` is a fraction 0..1 RELATIVE to the other camp (cf. header); `score` is the measurement.
 */
export interface ScoreBannerSide {
  /** Team identifier of the film — serves as render key, never as a label. */
  teamId: number
  /**
   * Score of the CURRENT ROUND at the frame read, reset to 0 at each round; == the total of the match
   * on a single-round mode. (The cumulative total, for its part, feeds the « Score over
   * time » curve of the match view, not this banner.)
   */
  score: number
  /** Part of bar filled, in [0,1]. */
  fill: number
}

/** The round in progress, when the mode has several — otherwise the banner does not speak of it. */
export interface ScoreBannerRound {
  /** Display rank from 1 (« Round 2 »). */
  index: number
  /** Number of rounds published. */
  count: number
}

/** The complete reading of the banner at a given frame. */
export interface ScoreBannerReading {
  ally: ScoreBannerSide
  enemy: ScoreBannerSide
  round: ScoreBannerRound | null
  /**
   * A dot per PLAYED round, at the frame read — full to the winning camp when the round is
   * decided, empty otherwise (`roundsLogic`). Empty on a single-round mode. The camp is already
   * translated to ally / enemy: the render only has to tint.
   */
  dots: RoundDot[]
}

/** What the banner reads from the allegiance of the film: the camps of the match, and the side of each. */
export type ScoreBannerFilm = Pick<FilmAllegiance, 'camps' | 'ofTeam'>

/**
 * readScoreBanner returns the reading of the banner, or `null` when it must not render:
 * layer without any camp, series published without camp, mode that does not oppose exactly two camps, or ally side
 * indeterminable (cf. header).
 *
 * THREE READERS, ONE RULE (review RR-L1-PARC-01, 2026-09-23): the banner
 * (`ReplayScoreBanner`), the victory panel (`ReplayVictoryOverlay`, final score line)
 * and the video export (`buildOverlayPanelSource`). These last two read the layer only as
 * a fallback to the score served by the API; on a series published without camp, they therefore keep silent the line
 * of score instead of writing « 0 — 0 », like the banner (6 documents in the park of 23/09).
 */
export function readScoreBanner(
  timeline: ReplayScoreTimelineReady | undefined,
  film: ScoreBannerFilm,
  frame: number,
): ScoreBannerReading | null {
  if (!timeline || timeline.teams.length === 0) return null
  if (timeline.teams.some((t) => t.teamId == null)) return null
  const camps = film.camps.map((camp) => camp.team)
  if (camps.length !== 2) return null
  const allyIdx = allySideIndex(film, camps)
  if (allyIdx === null) return null
  const allyId = camps[allyIdx]
  const enemyId = camps[1 - allyIdx]
  // The current round commands the WHOLE banner: the numerator (round score, reset to
  // zero at each round) AND the denominator (round ceiling). `cur === null` — no
  // round ventilated — falls back to the total of the match: graceful degradation, not a misreading.
  const cur = currentRoundAtFrame(timeline, frame)
  const allyScore = cur
    ? teamRoundScoreAtFrame(timeline, allyId, cur.round, frame)
    : teamScoreAtFrame(timeline, allyId, frame)
  const enemyScore = cur
    ? teamRoundScoreAtFrame(timeline, enemyId, cur.round, frame)
    : teamScoreAtFrame(timeline, enemyId, frame)
  const target = cur ? roundTargetOf(timeline) : victoryTarget(timeline, allyId, enemyId)
  return {
    ally: { teamId: allyId, score: allyScore, fill: fillOf(allyScore, target) },
    enemy: { teamId: enemyId, score: enemyScore, fill: fillOf(enemyScore, target) },
    round: roundOf(cur),
    dots: roundDots(timeline, allyId, enemyId, frame),
  }
}

/**
 * victoryTarget — the denominator of the two bars, CONSTANT over the whole reading (it is
 * what guarantees that a bar never goes back). Two sources, in order:
 *
 *  1. `timeline.targetScore` — the WINNING TARGET of the mode, published by the artifact from
 *     the measured table of the variant (regulation.toml [score_target]). It is the only
 *     correct reading on a victory ON THE CLOCK: a Slayer stopped at 43 displays 43/50, not
 *     a full bar (user feedback of 2026-08-24). The producer guarantees
 *     target >= finals; an artifact prior to the field carries none.
 *  2. the FINAL score of the winner, as a fallback (cf. header — in a game won at the
 *     target, it is the target; on the clock, it is an accepted lower bound, lacking data).
 *
 * The `1` covers the degenerate case of a match without a single point: 0 on 0 would fill
 * a whole bar while no one has scored.
 */
function victoryTarget(
  timeline: ReplayScoreTimelineReady,
  allyId: number,
  enemyId: number,
): number {
  if (timeline.targetScore != null && timeline.targetScore > 0) return timeline.targetScore
  return Math.max(finalScoreOf(timeline, allyId), finalScoreOf(timeline, enemyId), 1)
}

/** The END-OF-MATCH score of a camp: its last step, 0 without series (silent camp). */
function finalScoreOf(timeline: ReplayScoreTimelineReady, teamId: number): number {
  const total = teamSeriesFor(timeline, teamId)?.total ?? []
  return total.length > 0 ? total[total.length - 1].v : 0
}

/** fillOf — the part of bar of a camp: its score at the frame read, reported to the target. */
function fillOf(score: number, target: number): number {
  return Math.min(score / target, 1)
}

/**
 * roundTargetOf — the denominator of the bars ON A ROUND-BASED MODE: the ceiling of ONE round,
 * not the target of the match. The numerator restarts from zero at each round, so the denominator
 * must be that of the round, otherwise the bar would appear half as full at the second.
 *
 * Two sources, in order — like `victoryTarget`:
 *  1. `timeline.targetScore`: the round ceiling published by the artifact (100 for Oddball).
 *  2. as a fallback, the HIGHEST last-step of all the rounds of the two camps — in a
 *     round won at the ceiling, this last step IS the ceiling; bounded to 1 to never
 *     divide by zero (match without a single point).
 *
 * CONSTANT over the whole reading (does not depend on the frame): a bar never goes back, and the
 * ceiling is the same from round 1 to round N.
 */
function roundTargetOf(timeline: ReplayScoreTimelineReady): number {
  if (timeline.targetScore != null && timeline.targetScore > 0) return timeline.targetScore
  let max = 1
  for (const team of timeline.teams) {
    for (const r of team.rounds) {
      if (r.points.length === 0) continue
      max = Math.max(max, r.points[r.points.length - 1].v)
    }
  }
  return max
}

/**
 * allySideIndex says WHICH of the two camps is that of the watched player (0 or 1), or `null` when
 * the film does not say it: watched player absent from the film, without team, or of neither of the two camps.
 */
function allySideIndex(film: ScoreBannerFilm, camps: readonly number[]): 0 | 1 | null {
  if (film.ofTeam(camps[0]) === true) return 0
  if (film.ofTeam(camps[1]) === true) return 1
  return null
}

/**
 * roundOf returns the round in progress, and `null` on a single-round mode — where the indicator
 * would say nothing that the total does not already say.
 *
 * Receives the current round ALREADY READ (`currentRoundAtFrame`), the same one that commands the
 * numerator: « Round N » and the displayed score thus always designate the SAME round.
 * The shared bound of `currentRoundAtFrame` already covers the case of a camp that has scored in
 * no round (CTF witness), which would have under-declared the count.
 */
function roundOf(cur: CurrentRound | null): ScoreBannerRound | null {
  if (!cur || cur.count <= 1) return null
  return { index: cur.index, count: cur.count }
}
