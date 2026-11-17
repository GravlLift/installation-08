// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * scoreTimeline.ts — THE SCORE AT THE READ INSTANT, and what the film is entitled to say.
 *
 * WHY IN `lib/` AND NOT IN A FEATURE. Two surfaces read this layer: the 2D replay
 * (team headers, player cards, timeline) and the match view (the "Score over
 * time" curve). As long as it lived in `features/match-replay/`, the match view had to go
 * fetch it from its neighbor — a cross-feature import that the P8.5 ratchet
 * (`tools/lint-cross-feature-imports.mjs`) rightly refuses: the repo rule
 * (`frontend-patterns`) wants PURE logic shared in `lib/`, never in a feature
 * imported by another. This file is therefore the home, and the two features are its
 * clients on an equal footing.
 *
 * IT KNOWS NO FEATURE, and that is what makes it movable: the document's types
 * come from the generated contract (`lib/api/types`), and everything it expects from a document or
 * a player index is described STRUCTURALLY right here (`ReplayScoreDocument`,
 * `AllyIndex`). `ReplayDocumentReady` and `XuidMeta` conform to it without `lib/` having to
 * name them.
 *
 * WHAT THE ARTIFACT PUBLISHES (schema 12). The film's decoder does not transmit a sampled
 * score: it transmits CHANGES. A series is therefore a sequence of STEPS —
 * `{t, v}` means "starting at frame t, the value is v", and nothing is emitted as long
 * as nothing moves. Reading this series at the current frame means taking the last value
 * transmitted at or before this frame: exactly the pattern of `heldReading`
 * (match-replay/replayLogic), transposed to a quantity that does not age. A score does not
 * FADE — there is no "stale" reading of a score, there is only the score, which
 * stays what it is until the next point. That is why this reading returns a number and
 * not a `HeldReading`.
 *
 * TWO QUANTITIES THAT MUST NOT BE CONFUSED. `total` is the match's cumulative total, `rounds[]` the
 * value WITHIN each round — the one that resets to zero at the next Oddball round. The
 * `24dbb67d` reference shows it: rounds 100/78 then 100/43, total 200/121. Showing
 * one for the other is a 79-point error.
 *
 * A TEAM WITHOUT A SERIES IS WORTH ZERO, AND THAT IS A MEASUREMENT. The CTF reference `530820e5`
 * (3-0) publishes only ONE team series: the side that never scored emits nothing at all. Its
 * score is not unknown — it is zero, and the film says so by staying silent. It is the only
 * place in this module where an absence reads as a zero, and `teamSeriesFor` is what
 * concentrates it into one point (see its comment).
 *
 * A PLAYER WITHOUT A SERIES, ON THE OTHER HAND, IS NOT AT ZERO — THEY ARE NOT PUBLISHED. The distinction is
 * the opposite of the previous one and it is vital: on the Slayer reference, 6 of 8 players have
 * counters, the other 2 have none at all (phase 0 measurement: Oddball 0/32, a whole mode
 * with no player counters). Showing "0 frags" for someone the film did not match
 * would be a false statement. Hence `playerCountersAt`, which returns `null`, never
 * a zeroed object.
 *
 * This whole file is PURE: no React, no canvas, no DOM.
 */
import type {
  ReplayPlayerScore,
  ReplayScoreRound,
  ReplayScoreSeries,
  ReplayScoreTick,
  ReplayScoreTimeline,
  ReplayTeamHold,
  ReplayTeamScore,
} from '@/lib/api/types'

// ---------------------------------------------------------------------------------------
// The layer's types, once filled in
// ---------------------------------------------------------------------------------------

/**
 * THE FOUR TIERS OF THE SCORE LAYER (schema 12), and why they need four types.
 *
 * `scoreTimeline` is the first field in the document that stacks nullable arrays over
 * FOUR levels: `teams` -> `rounds` -> `points`, and `players` -> `score|kills|deaths|
 * assists` -> `rounds` -> `points`. The document's head guard
 * (`match-replay/replayContract.test.ts`) only sees the root; it is its path walker
 * that now requires each of these levels, and it is these very types that prove
 * to the compiler that they are filled in.
 */
export type ReplayScoreRoundReady = Omit<ReplayScoreRound, 'points'> & {
  points: ReplayScoreTick[]
}
export type ReplayScoreSeriesReady = Omit<ReplayScoreSeries, 'rounds' | 'total'> & {
  rounds: ReplayScoreRoundReady[]
  total: ReplayScoreTick[]
}
export type ReplayTeamScoreReady = Omit<ReplayTeamScore, 'rounds' | 'total'> & {
  rounds: ReplayScoreRoundReady[]
  total: ReplayScoreTick[]
}
export type ReplayPlayerScoreReady = Omit<
  ReplayPlayerScore,
  'assists' | 'deaths' | 'kills' | 'score'
> & {
  assists: ReplayScoreSeriesReady
  deaths: ReplayScoreSeriesReady
  kills: ReplayScoreSeriesReady
  score: ReplayScoreSeriesReady
}
export type ReplayTeamHoldReady = Omit<ReplayTeamHold, 'ticks'> & {
  ticks: ReplayScoreTick[]
}
export type ReplayScoreTimelineReady = Omit<
  ReplayScoreTimeline,
  'players' | 'teams' | 'holdTicks'
> & {
  players: ReplayPlayerScoreReady[]
  teams: ReplayTeamScoreReady[]
  holdTicks: ReplayTeamHoldReady[]
}

/**
 * ReplayScoreDocument — the strict minimum a replay document must carry for these
 * readings to make sense.
 *
 * STRUCTURAL, NOT NOMINAL: `ReplayDocumentReady` (the boundary of `match-replay`) conforms
 * to it without `lib/` having to know it. This is exactly what lets this
 * logic live outside the features — the dependency runs from the feature to `lib/`, never
 * the other way around.
 */
export interface ReplayScoreDocument {
  originMs?: number
  coverage?: { originResolved?: boolean }
  scoreTimeline?: ReplayScoreTimelineReady
}

// ---------------------------------------------------------------------------------------
// The boundary: filling in the layer's five nullable arrays
// ---------------------------------------------------------------------------------------

/** A round whose steps are filled in: an empty array means "no point scored". */
function normalizeRound(r: ReplayScoreRound): ReplayScoreRoundReady {
  return { ...r, points: r.points ?? [] }
}

/**
 * A player's series (score, frags, deaths, assists), its two arrays filled in.
 *
 * `series` may be missing even though the contract declares it mandatory: that is precisely
 * the role of a boundary, not to choke on a producer that misbehaves. The result is
 * empty, never invented — and what distinguishes "this player is not published" from "this player
 * is at zero" is decided one level up, on their PRESENCE in `players`.
 */
function normalizeSeries(series: ReplayScoreSeries | undefined): ReplayScoreSeriesReady {
  return {
    ...series,
    rounds: (series?.rounds ?? []).map(normalizeRound),
    total: series?.total ?? [],
  }
}

/**
 * normalizeScoreTimeline fills in the SEVEN nullable arrays of the score layer
 * (`teams`, `players`, `rounds`, `total`, `points`, `holdTicks` and its `ticks`) and returns
 * the layer's absence as-is: `undefined` in, `undefined` out.
 *
 * THE OBJECT KEEPS THE RIGHT TO BE ABSENT: an artifact from a schema earlier than 12 carries
 * none, and an empty object would read as "the film was read, there was no score".
 */
export function normalizeScoreTimeline(
  raw: ReplayScoreTimeline | undefined,
): ReplayScoreTimelineReady | undefined {
  if (!raw) return undefined
  return {
    ...raw,
    players: (raw.players ?? []).map((p) => ({
      ...p,
      assists: normalizeSeries(p.assists),
      deaths: normalizeSeries(p.deaths),
      kills: normalizeSeries(p.kills),
      score: normalizeSeries(p.score),
    })),
    teams: (raw.teams ?? []).map((t) => ({
      ...t,
      rounds: (t.rounds ?? []).map(normalizeRound),
      total: t.total ?? [],
    })),
    // THE HILL'S HOLD: same regime as the layer's other series.
    holdTicks: (raw.holdTicks ?? []).map((h) => ({ ...h, ticks: h.ticks ?? [] })),
  }
}

// ---------------------------------------------------------------------------------------
// The clock guard
// ---------------------------------------------------------------------------------------

/**
 * filmClockTrusted — does the artifact know WHERE its time starts?
 *
 * WHY THIS GUARD EXISTS (P2 of the adversarial review of batch A phase 1, 2026-08-18 log). The
 * `objectives[]` and `scoreTimeline` layers are dated by the FILM's clock, then realigned to
 * the document's grid by subtracting `originMs`. When the origin could not be resolved AND
 * no value is published, this realignment did not happen: the frames are offset by an
 * UNKNOWN gap — measured from 3.6 s to 50.8 s depending on the match.
 * A score that ticks 30 s too early is worse than an absent score: it reads as correct.
 *
 * `coverage.originResolved` is a NON-pointer boolean: a schema-11 artifact served
 * as-is therefore says `false` even though it carries a perfectly valid `originMs`. That is
 * exactly why the rule requires BOTH conditions — the flag being `false` alone proves
 * nothing about documents predating the field.
 */
export function filmClockTrusted(doc: ReplayScoreDocument): boolean {
  return !(doc.coverage?.originResolved === false && doc.originMs == null)
}

/**
 * scoreTimelineOf — the ONLY access point to the score layer, and it carries the clock guard.
 *
 * Going through a single point rather than through `doc.scoreTimeline` keeps a
 * future consumer from forgetting the guard: the oversight would not show on screen, it would
 * read as a measurement. `undefined` means "nothing to display" — artifact predating schema 12,
 * mode without counters, or an unrealigned clock.
 */
export function scoreTimelineOf(doc: ReplayScoreDocument): ReplayScoreTimelineReady | undefined {
  if (!filmClockTrusted(doc)) return undefined
  return doc.scoreTimeline
}

// ---------------------------------------------------------------------------------------
// Readings at the current frame
// ---------------------------------------------------------------------------------------

/**
 * scoreAtFrame returns the value of the current step: the last one transmitted at or before
 * `frame`, and 0 before the first point.
 *
 * ZERO BEFORE THE FIRST POINT IS NOT AN INVENTION: the series only starts at the first
 * change, and before the first change the score IS zero — it is the start of the match.
 * Binary search: the timeline moves frame by frame and the team series
 * count up to 800 steps.
 */
export function scoreAtFrame(points: readonly ReplayScoreTick[], frame: number): number {
  if (points.length === 0 || frame < points[0].t) return 0
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid].t <= frame) lo = mid
    else hi = mid - 1
  }
  return points[lo].v
}

/**
 * teamSeriesFor returns a team's series, or `null` when the film publishes none for it.
 *
 * `null` AND ZERO SAY THE SAME THING HERE, unlike the rest of the layer: a team
 * that never scored emits no step at all (CTF reference 3-0, a single series for two
 * sides). Callers who want a number go through `teamScoreAtFrame`, which returns 0 —
 * the film's truth. Those who want to know whether the side has a series (so as not to draw
 * a flat curve where there is no data) read this `null`.
 */
export function teamSeriesFor(
  timeline: ReplayScoreTimelineReady | undefined,
  teamId: number | null,
): ReplayTeamScoreReady | null {
  if (!timeline || teamId == null) return null
  return timeline.teams.find((t) => t.teamId === teamId) ?? null
}

/** teamScoreAtFrame — the team's TOTAL at the current frame; 0 without a series (see above). */
export function teamScoreAtFrame(
  timeline: ReplayScoreTimelineReady | undefined,
  teamId: number | null,
  frame: number,
): number {
  return scoreAtFrame(teamSeriesFor(timeline, teamId)?.total ?? [], frame)
}

/**
 * teamRoundScoreAtFrame — a side's score WITHIN a round at the current frame.
 *
 * THIS IS THE QUANTITY THAT RESETS TO ZERO each round, where `teamScoreAtFrame` returns the
 * match's cumulative total. Returns 0 before the round's first step (the round's counter
 * has not moved yet) and 0 if the side has no such round at all — a side silent
 * on a round is worth zero, exactly as on the total (CTF reference 3-0). The single point
 * of the `find(round) + scoreAtFrame` pattern: `roundFinal` (roundsLogic) delegates to it.
 */
export function teamRoundScoreAtFrame(
  timeline: ReplayScoreTimelineReady | undefined,
  teamId: number | null,
  roundNumber: number,
  frame: number,
): number {
  const team = teamSeriesFor(timeline, teamId)
  const r = team?.rounds.find((x) => x.round === roundNumber)
  return r ? scoreAtFrame(r.points, frame) : 0
}

/** A player's four live counters, at the current frame. */
export interface PlayerCounters {
  score: number
  kills: number
  deaths: number
  assists: number
}

/** playerScoreFor returns a player's counter card, or `null` if they are not published. */
export function playerScoreFor(
  timeline: ReplayScoreTimelineReady | undefined,
  xuid: string,
): ReplayPlayerScoreReady | null {
  if (!timeline) return null
  return timeline.players.find((p) => p.xuid === xuid) ?? null
}

/**
 * playerCountersAt returns a player's four counters at the current frame, or `null`.
 *
 * `null` MEANS "THIS PLAYER IS NOT PUBLISHED", never "they are at zero". The card
 * then does NOT display the live line and keeps its end-of-match totals, which come from
 * the database — two different quantities, never silently mixed.
 */
export function playerCountersAt(
  timeline: ReplayScoreTimelineReady | undefined,
  xuid: string,
  frame: number,
): PlayerCounters | null {
  const p = playerScoreFor(timeline, xuid)
  if (!p) return null
  return {
    score: scoreAtFrame(p.score.total, frame),
    kills: scoreAtFrame(p.kills.total, frame),
    deaths: scoreAtFrame(p.deaths.total, frame),
    assists: scoreAtFrame(p.assists.total, frame),
  }
}

// ---------------------------------------------------------------------------------------
// Lead changes
// ---------------------------------------------------------------------------------------

/** A LEAD CHANGE: the moment the match changes leader. */
export interface LeadChange {
  /** Document frame at which the new leader takes the lead. */
  frame: number
  /** Team identifier of the new leader. */
  teamId: number
}

/**
 * leadChanges returns the moments where the leader CHANGES — the match's lead changes.
 *
 * WHAT A LEAD CHANGE IS, AND IS NOT. The leader is the team alone in front; a
 * tie has no leader and therefore does not count as a lead change — it SUSPENDS it.
 * Retaking the lead after a tie, however, IS a lead change if it is the other
 * side retaking it: it is the comparison against the last KNOWN leader that decides, not the
 * last instant. The match's first takeover of the lead is not one either: nobody
 * was ahead before it.
 *
 * Generalizes to more than two sides (a big battle) without anything changing: the leader is
 * the UNIQUE argmax; two sides tied for the lead designate no one.
 *
 * Measured on the three references (2026-08-18): Slayer `000d5950` 0 lead changes (the
 * winning side leads from start to finish, two ties at 1 and at 2), CTF `530820e5` 0 (a single
 * side scores), Oddball `24dbb67d` 3 — this is the reference for this measurement.
 */
export function leadChanges(timeline: ReplayScoreTimelineReady | undefined): LeadChange[] {
  const out: LeadChange[] = []
  let previous: number | null = null
  for (const state of leaderStates(timeline)) {
    // A TIE DOES NOT CLOSE THE PREVIOUS LEADER here: it suspends it (see the header). The
    // comparison is against the last KNOWN leader, not the last state.
    if (state.teamId == null) continue
    if (previous != null && state.teamId !== previous) out.push({ frame: state.frame, teamId: state.teamId })
    previous = state.teamId
  }
  return out
}

/**
 * A STATE of the race for the score: starting at this frame, here is who leads — or no one.
 * `teamId: null` IS a measurement: the sides are tied, not "unknown".
 */
export interface LeadState {
  frame: number
  teamId: number | null
}

/**
 * leaderStates returns the sequence of states of the race for the score: one state per CHANGE,
 * ties included. This is the complete reading of which `leadChanges` is only a projection (only
 * the lead changes, the tie erased) — the two therefore cannot diverge, and there is only one
 * implementation of "who leads" in the repo.
 *
 * WHY TIES COME OUT HERE. The replay timeline's SCORE track PAINTS them (the
 * repo's tie ink): a mode where both sides stay close for a long time has a blue
 * track, and that is a fact of the match. `leadChanges`, on the other hand, dates lead changes —
 * a tie is not one.
 *
 * The first state is that of the FIRST step published, whatever it is: before it, the layer says
 * nothing (0-0 is the caller's business, who alone knows where their timeline starts).
 *
 * THE ONE-SIDED MATCH (`campCount`, replay feedback 2026-09-23, batch L1.2). A 3-0 publishes
 * only one series: the silent side never scored, and "a team without a series is worth zero" (module
 * header). When the caller provides the DOCUMENT's side count (`campCountOf`) and
 * ALL published series have a side, each absent side competes at 0: the race reads
 * "tie, then whoever scores takes the lead". Absent sides are COUNTED, never named — they cannot
 * lead, and their identifier does not live in the layer's space. A single series
 * without a side is enough to silence everything: nothing then says who is scoring.
 */
export function leaderStates(
  timeline: ReplayScoreTimelineReady | undefined,
  campCount = 0,
): LeadState[] {
  const published = timeline?.teams ?? []
  // A team WITHOUT an identifier can be neither leading nor led: comparing it would amount
  // to crowning the only one that has one (`coverage.score.teamIdentity = "unresolved"`).
  const teams = published.filter((t) => t.teamId != null)
  const absents = teams.length === published.length ? Math.max(0, campCount - teams.length) : 0
  if (teams.length === 0 || teams.length + absents < 2) return []
  const frames = [...new Set(teams.flatMap((t) => t.total.map((p) => p.t)))].sort((a, b) => a - b)
  const out: LeadState[] = []
  for (const frame of frames) {
    const leader = leaderAt(teams, frame, absents > 0)
    if (out.length > 0 && leader === out[out.length - 1].teamId) continue
    out.push({ frame, teamId: leader })
  }
  return out
}

/**
 * campCountOf — the number of SIDES that the film writes to the roster (`roster[].team`, schema 57):
 * the distinct designators, excluding "no team" (`-1`) and silence (field absent). It only
 * serves to COUNT the silent sides for `leaderStates`; 0 = the document does not say.
 */
export function campCountOf(roster: ReadonlyArray<{ team?: number | null }>): number {
  const camps = new Set<number>()
  for (const r of roster) if (r.team != null && r.team >= 0) camps.add(r.team)
  return camps.size
}

/**
 * leaderAt returns the team ALONE in the lead at the given frame, or `null` (tie, no points).
 * `mutes`: at least one side without a series competes at ZERO (see `leaderStates`) — a side published
 * at 0 is then tied with it, and only a strictly positive score leads.
 */
function leaderAt(teams: readonly ReplayTeamScoreReady[], frame: number, mutes = false): number | null {
  let best = mutes ? 0 : -1
  let bestTeam: number | null = null
  let tied = mutes
  for (const t of teams) {
    if (t.teamId == null) continue
    const v = scoreAtFrame(t.total, frame)
    if (v > best) {
      best = v
      bestTeam = t.teamId
      tied = false
    } else if (v === best) {
      tied = true
    }
  }
  return tied ? null : bestTeam
}
