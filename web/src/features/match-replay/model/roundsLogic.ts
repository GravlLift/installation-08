/**
 * roundsLogic — THE ROUNDS OF A MULTI-ROUND MATCH, read in the score layer.
 *
 * Oddball is the first mode to go to the replay that is played in SEVERAL ROUNDS (first to
 * two wins, three at most). This module says three things that the score layer carries without
 * naming them: HOW MANY rounds have been played, WHO won each one, and WHERE they
 * touch (the flip from one round to the next). The banner takes its dots from it, the
 * inter-round screen takes its flip. PURE module: no React, no DOM, no color, no label.
 *
 * WHAT THE FILM PUBLISHES, AND WHAT IT DOES NOT. Each team carries its `rounds[]`
 * (`ReplayTeamScoreReady`), and a round is a sequence of steps `{t, v}` that RESTARTS FROM
 * ZERO at the next round (cf. `scoreTimeline.ts`). The film publishes NO threshold of
 * « rounds won »: `targetScore` is the score ceiling INSIDE a round (100 for
 * Oddball), not the « first to two ». One therefore does not code « three rounds » in hard — the
 * number of dots is the number of rounds ACTUALLY PLAYED (those that carry at least
 * one step), and a full dot is a round already DECIDED at the frame read.
 *
 * THE WINNER OF A ROUND IS DEDUCED, IT IS NOT ASSUMED: it is the camp with the round score
 * highest AT THE END of the round (the last step of the round). A mode where one wins
 * by reaching the ceiling ends on that ceiling; a mode stopped on the clock ends on the gap —
 * in both cases, the highest wins. A round where both end level (case
 * degenerate, that Oddball does not produce since a round is won at 100) names no one:
 * empty dot, never an invented winner.
 *
 * « ALLY / ENEMY » IS RELATIVE TO THE PLAYER OF THE PAGE, as everywhere on the replay: the bridge
 * between the `teamId` of the film and these two notions is done by the caller (`scoreBannerLogic`),
 * which alone reads the scoreboard. This module receives the two team identifiers already ruled.
 *
 * A ROUND IS DECIDED AT THE FRAME READ when the reading has reached its LAST STEP — the instant
 * where the score of the round stops moving, that is to say where it is won (the ceiling reached
 * in Oddball, the gap frozen on the clock). The film being complete, this last step IS the decisive
 * instant: before it the round is in progress, after it it is won. The dot therefore fills
 * AT THE MOMENT OF THE VICTORY, not at the opening of the next round (there is an interlude
 * between the two) — derived from the reading position, it empties when one goes back up the timeline.
 *
 * THE FLIP SHARES THIS BOUND (`roundTransitions`), AND IT IS A FIX OF 2026-08-29.
 * It was dated AT THE BEGINNING OF THE NEXT ROUND — « we pass to the following », at the resume — and
 * it is from there that the message « Round N finished » and the voice of the announcer set out. But this
 * beginning is not an instant of the flow: it is the FIRST SCORE STEP of the round
 * next, therefore the moment when someone scores again, after the interlude AND after the time
 * it takes to take up the skull again. Measurement on the four multi-round witnesses of the
 * artifact folder (2026-08-29, `data/cache/replays/halo_infinite`): 24dbb67d +26.9 s; 43716616
 * +19.0 s; 51ebbc0f +28.9 s; d9781168 +34.1 s then +21.5 s. The announcement therefore arrived a
 * half-minute after the round it announced, on top of the next round already started.
 *
 * RULE OF THE DEPOSIT (user feedback of 2026-08-29): a message, a sound, a voice triggers
 * ON ITS EVENT when that event is dated, and on T0 otherwise — never on an
 * neighboring instant. The event, here, is the end of the round: the last step, that very one which
 * fills the dot. The two bounds therefore make one, and there is only one
 * instant « round end » in the whole replay.
 *
 * # THIS LAST STEP IS NOT A FALLBACK: IT IS THE ROUND MARK OF THE FILM
 *
 * The question deserves to be written because it will be re-asked: the film publishes NO
 * event « round finished », so what does one really lean on?
 *
 * On the fact that the film LABELS EACH OF ITS RECORDINGS BY A ROUND
 * (`StatRecord.Round`, statborg — cf. `film/facts/objectives/statborg.go`). All the series
 * that the artifact draws from it are therefore bounded by the round: the MODE score of each camp, and
 * the four counters of EACH player (personal score, frags, deaths, assists). Measurement of
 * 2026-08-29 on the 4 multi-round films of the artifact folder, 5 flips:
 * **all these series freeze on the SAME frame, to the zero millisecond** (measured gap
 * between « last step of the team » and « last step all series combined »: 0.0 s, 5
 * times out of 5). It is therefore not « the last point scored » that one reads, it is **the instant when the
 * film stops describing this round**.
 *
 * TWO PRACTICAL CONSEQUENCES:
 *  - no use in publishing round bounds from the Go decoder: they would fall on
 *    exactly this frame, at the price of a schema field and a re-bake of all the
 *    artifacts;
 *  - no use in looking for a « more physical » signal. The field DOES EMPTY (the film
 *    stops publishing everyone for 0.5 to 1.7 s, the time of the teleportation) but
 *    **7.6 to 9.1 s AFTER**: it is the end-of-round screen of the game, not its end. Aligning there
 *    would put back an offset of eight seconds where one just removed thirty.
 *
 * THE LIMIT THAT REMAINS, NAMED: a round closed ON THE CLOCK where no one scores NOr
 * dies in the last seconds would freeze its series a little before its real end. The corpus
 * contains none of it (the 5 flips end at the round ceiling — 80 or 100 according to the
 * variant), and the error would be AHEAD by a few seconds, not by thirty. One does not correct
 * what one has not measured: the day a film shows it, it is here that one will have to come back.
 */
import {
  teamRoundScoreAtFrame,
  type ReplayScoreTimelineReady,
} from '@/lib/replay/scoreTimeline'

/** The winning camp of a round, from the point of view of the player of the page. */
export type RoundWinner = 'ally' | 'enemy'

/** A round dot, at the frame read. */
export interface RoundDot {
  /** Round number of the film (0-based) — render key, never a label. */
  round: number
  /**
   * The winner, when the round is DECIDED at the frame read (full dot); `null` when
   * it is in progress, to play, or ended on a tie (empty dot).
   */
  winner: RoundWinner | null
}

/** A round flip: the instant where a round ends. */
export interface RoundTransition {
  /** Display rank (1-based) of the round that just ended. */
  endedIndex: number
  /**
   * Frame of the film where the round ended — its LAST SCORE STEP, the same bound
   * as the full dot of the banner (cf. the header). It is no longer the beginning of the round
   * next: that one falls 19 to 34 s later on the measured witnesses.
   */
  frame: number
}

/** An ordered round of the match: its number, its start and its closing bound, in frames. */
interface OrderedRound {
  round: number
  /** Frame of the first step of the round (all teams combined). */
  start: number
  /** Frame of the LAST step of the round: from it on, the round is decided (won). */
  end: number
}

/**
 * orderedRounds returns the PLAYED rounds of the match, in order, with their closing bound.
 *
 * A « played » round carries at least one step at one of the two camps. A round that the
 * film informs nowhere does not exist here — no dot for a ghost round.
 * The order is that of the NUMBERS of round (0-based, increasing with time).
 */
function orderedRounds(timeline: ReplayScoreTimelineReady): OrderedRound[] {
  const byRound = new Map<number, { start: number; last: number }>()
  for (const team of timeline.teams) {
    for (const r of team.rounds) {
      if (r.points.length === 0) continue
      const first = r.points[0].t
      const last = r.points[r.points.length - 1].t
      const cur = byRound.get(r.round)
      if (!cur) byRound.set(r.round, { start: first, last })
      else {
        cur.start = Math.min(cur.start, first)
        cur.last = Math.max(cur.last, last)
      }
    }
  }
  const nums = [...byRound.keys()].sort((a, b) => a - b)
  return nums.map((round) => {
    const cur = byRound.get(round)!
    return { round, start: cur.start, end: cur.last }
  })
}

/** roundCount returns the number of PLAYED rounds — 0 or 1 when the mode is not multi-round. */
export function roundCount(timeline: ReplayScoreTimelineReady | undefined): number {
  return timeline ? orderedRounds(timeline).length : 0
}

/** The current round of a MATCH (not of a camp), and what it takes to name it. */
export interface CurrentRound {
  /** Round number of the film (0-based) — serves the per-round numerator, never a label. */
  round: number
  /** Display rank from 1 (« Round 2 »). */
  index: number
  /** Number of PLAYED rounds. */
  count: number
}

/**
 * currentRoundAtFrame returns the round IN PROGRESS at the frame read, or `null` if no round is
 * ventilated (undeclared round-less mode, layer absent).
 *
 * THE BOUND IS SHARED: a round starts at the first step of one OR the other camp
 * (`orderedRounds.start` already takes the min of the two). The two bars of the banner therefore flip
 * TOGETHER, never one before the other. The current round is the LAST one whose beginning
 * has already passed; before the first beginning, it is the first one (the match has started, not the
 * counter). In the inter-round window — between the end of a round and the beginning of the
 * next — it is still the PREVIOUS round: its counter holds until the resume.
 * A single-round mode returns `{index: 1, count: 1}`.
 */
export function currentRoundAtFrame(
  timeline: ReplayScoreTimelineReady | undefined,
  frame: number,
): CurrentRound | null {
  if (!timeline) return null
  const rounds = orderedRounds(timeline)
  if (rounds.length === 0) return null
  let idx = 0
  for (let i = 0; i < rounds.length; i++) {
    if (rounds[i].start <= frame) idx = i
  }
  return { round: rounds[idx].round, index: idx + 1, count: rounds.length }
}

/**
 * roundDots returns a dot per played round, at the frame read — full (to the winning camp) when
 * the round is decided, empty otherwise. Empty array on a single-round mode (a single
 * dot would say nothing that the total does not already say).
 */
export function roundDots(
  timeline: ReplayScoreTimelineReady | undefined,
  allyId: number,
  enemyId: number,
  frame: number,
): RoundDot[] {
  if (!timeline) return []
  const rounds = orderedRounds(timeline)
  if (rounds.length <= 1) return []
  return rounds.map((r) => ({
    round: r.round,
    winner: frame >= r.end ? winnerOfRound(timeline, allyId, enemyId, r) : null,
  }))
}

/**
 * roundTransitions returns the round flips: one per passage from one round to the next.
 * No flip on a single-round mode. The flip is dated at the END of the round that
 * ends (its last step), not at the beginning of the next one — cf. the header and the measurement.
 *
 * THE LAST ROUND PRODUCES NONE OF IT, and it is unchanged: its end is the end of the MATCH, that
 * the end screen and the voice of conclusion already announce (`ReplayVictoryOverlay`,
 * `endMatchSound.ts`). Two announcements on the same instant would tread on each other.
 */
export function roundTransitions(
  timeline: ReplayScoreTimelineReady | undefined,
): RoundTransition[] {
  if (!timeline) return []
  const rounds = orderedRounds(timeline)
  const out: RoundTransition[] = []
  for (let i = 1; i < rounds.length; i++) {
    out.push({ endedIndex: i, frame: rounds[i - 1].end })
  }
  return out
}

/**
 * activeRoundTransition returns the flip whose DISPLAY WINDOW contains the frame read, or
 * `null`. The window runs from the flip to `windowFrames` frames further; one keeps the
 * MOST RECENT one that contains it (two windows do not overlap on a real match, but
 * the most recent is the right answer if they did). Derived from the position of
 * reading, exactly like the end screen: it replays if one passes over it again, and
 * disappears as soon as one leaves it.
 */
export function activeRoundTransition(
  transitions: readonly RoundTransition[],
  frame: number,
  windowFrames: number,
): RoundTransition | null {
  let best: RoundTransition | null = null
  for (const tr of transitions) {
    if (frame >= tr.frame && frame < tr.frame + windowFrames) {
      if (!best || tr.frame > best.frame) best = tr
    }
  }
  return best
}

/** winnerOfRound compares the END-OF-ROUND scores of the two camps; `null` on a tie. */
function winnerOfRound(
  timeline: ReplayScoreTimelineReady,
  allyId: number,
  enemyId: number,
  r: OrderedRound,
): RoundWinner | null {
  const ally = roundFinal(timeline, allyId, r.round, r.end)
  const enemy = roundFinal(timeline, enemyId, r.round, r.end)
  if (ally > enemy) return 'ally'
  if (enemy > ally) return 'enemy'
  return null
}

/**
 * roundFinal returns the score of a camp INSIDE a round at the closing bound — its last
 * step of the round. 0 when the camp has no series for this round (it did not score),
 * which is a measurement and not a gap (cf. the doctrine « a team without series is worth zero »).
 *
 * Delegates to `teamRoundScoreAtFrame` (the single point of the pattern `find(round) + scoreAtFrame`):
 * read at the closing bound, the round score IS its final score.
 */
function roundFinal(
  timeline: ReplayScoreTimelineReady,
  teamId: number,
  roundNumber: number,
  endFrame: number,
): number {
  return teamRoundScoreAtFrame(timeline, teamId, roundNumber, endFrame)
}
