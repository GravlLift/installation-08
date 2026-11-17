// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * matchClock.ts — THE THREE TIME AXES OF A MATCH, AND THE CONVERSIONS BETWEEN THEM.
 *
 * WHY THIS MODULE EXISTS. The match page and the 2D replay place dated facts side by side
 * even though those facts do NOT count from the same instant. The server contract says so
 * without detours (`apps/go-api/internal/domain/match_view.go`, field `T0Ms`): "the events
 * served by this page are re-based on the start of GAMEPLAY, while the film — so the 2D
 * replay — starts from the start of the MATCH, countdown included. Without this offset, a
 * consumer that places both on the same timeline shifts the kills by ~18 to 28 s." (original
 * French: « les events servis par cette page sont recalés sur le début du GAMEPLAY tandis que
 * le film — donc le rejeu 2D — part du début du MATCH, countdown compris. Sans cet offset, un
 * consommateur qui pose les deux sur la même timeline décale les kills de ~18 à 28 s. »). This
 * module is that consumer, written once.
 *
 * THE THREE AXES, AND WHAT ANCHORS THEM.
 *
 *   1. THE MATCH AXIS — milliseconds since `header.start_time`, the instant the API dates.
 *      It is the axis of the absolute timestamps (media, match join/leave).
 *   2. THE FILM AXIS — milliseconds from the artifact's ZERO FRAME, that is from its first
 *      position packet. `doc.originMs` says where that zero frame falls on the match axis;
 *      the measured gap ranges from 3.6 s to 50.8 s depending on the match, never zero. A
 *      frame `t` is worth `t × frameIntervalMs` on this axis.
 *   3. THE GAMEPLAY AXIS — milliseconds since the KICK-OFF. It is the axis of
 *      `event_time_ms`: the server has already subtracted the countdown
 *      (`correctMatchViewEventsT0`), and `header.t0_ms` is precisely the subtracted value.
 *      Hence the identity that grounds this whole file: on this axis, `event_time_ms` reads
 *      AS-IS, with no correction term.
 *
 * THE TWO SUBTRACTIONS, AND NOTHING ELSE.
 *
 *     msFilm     = event_time_ms + t0_ms − originMs
 *     msGameplay = frame × frameIntervalMs + originMs − t0_ms
 *
 * THE GO WRITES ONLY HALF OF THE FIRST, and the nuance is worth stating (review R1):
 * `match_view.go` sets `msFilm = event_time_ms + t0_ms`, that is the return to the MATCH
 * axis — it ignores the film, which it does not see. The `− originMs` is this module's part:
 * it then brings things back to the FRAMES axis, which only the artifact knows. The formula
 * is therefore right, but it is not a quote.
 *
 * The second is the inverse of the first; putting both here is what prevents one surface from
 * applying one and its neighbor none.
 *
 * TWO KICK-OFFS COEXIST, AND THIS MODULE ANCHORS ON THE API'S. `header.t0_ms` is ESTIMATED
 * from the `first_joined_time`; `doc.t0FilmMs` is MEASURED in the film (first real motion),
 * and the 2D replay prefers it for ITS displayed clock (`replayWindow.ts`, decision D5 of the
 * T0-film plan, 2026-09-02). The gameplay axis defined here, for its part, is anchored on
 * `header.t0_ms` and cannot be anchored elsewhere: it is the anchor the producer subtracted
 * to make `event_time_ms`. Substituting the film T0 there would move the cumulative frags —
 * the series that is already right. The two anchors are therefore carried side by side, and
 * `t0FilmMs` stays available for whoever displays a PLAYBACK clock.
 *
 * NO ORIGIN, NO CLOCK. `doc.originMs` absent (artifact predating schema 4, or an origin the
 * producer REFUSED to establish — unreadable chunk, contradictory witness): the gap between
 * the two axes is an unknown of 3.6 to 50.8 s, and `matchClock` returns `null`. Zero is not
 * an acceptable fallback; the producer writes it itself
 * (`internal/games/halo_infinite/film/replay/origin.go`: "ZERO IS NOT A NEUTRAL ORIGIN, IT IS
 * A FALLBACK" — original French: « ZERO N'EST PAS UNE ORIGINE NEUTRE, C'EST UN REPLI »).
 * Measurement of the local fleet as of 2026-09-05: 5 artifacts out of 106 without an origin,
 * and all five already carry `coverage.originResolved: false` — they are therefore already
 * ruled out upstream by `filmClockTrusted`, and this gate removes no card from the screen.
 *
 * IT KNOWS NO FEATURE. What it expects of a document is described STRUCTURALLY here
 * (`MatchClockDocument`): `ReplayDocumentReady` (match-replay) conforms to it without `lib/`
 * having to name it. Same rule as `scoreTimeline.ts`, and for the same reason — two features
 * are equal clients of it.
 *
 * This whole file is PURE: no React, no canvas, no DOM.
 */
import type { MatchViewHeader } from '@/lib/api/types'

/**
 * The strict minimum a replay document must carry for a clock to be established.
 * Structural, never nominal (see the header).
 */
export interface MatchClockDocument {
  /** Instant of the film's zero frame on the MATCH axis. Absent = no clock. */
  originMs?: number
  /** Kick-off MEASURED in the film, on the match axis. Absent before schema 36. */
  t0FilmMs?: number
  /** Actual duration of a frame. Absent = no time scale, no clock. */
  frameIntervalMs?: number
  frameCount: number
}

/** What the clock reads from the match header: the anchor of `event_time_ms`. */
export type MatchClockHeader = Pick<MatchViewHeader, 't0_ms'>

/** An ESTABLISHED clock: the four quantities, and the conversions that follow from them. */
export interface MatchClock {
  /** `doc.originMs` — the film's zero frame on the match axis. */
  originMs: number
  /**
   * `header.t0_ms` — the pre-match countdown, in ms, as the server subtracted it to
   * produce `event_time_ms`. Zero when it is unknown: the correction then did not happen
   * on the events side either, and adding nothing is exactly right.
   */
  t0Ms: number
  /**
   * `doc.t0FilmMs` — the kick-off MEASURED in the film, on the match axis, or `null`.
   * This module's gameplay axis does NOT anchor on it (see the header); it is carried here
   * for the PLAYBACK clocks, which prefer it over the API's estimate.
   */
  t0FilmMs: number | null
  frameIntervalMs: number
  frameCount: number
  /**
   * gameplayMsOfFilmMs — an instant of the FILM axis, read on the GAMEPLAY clock.
   * `filmMs + originMs − t0Ms`. Negative before the kick-off: the film overruns the match
   * by the countdown, and this module does not clamp it — clamping is up to the display.
   */
  gameplayMsOfFilmMs(filmMs: number): number
  /** gameplayMsOfFrame — a FILM frame, read on the gameplay clock. */
  gameplayMsOfFrame(frame: number): number
  /**
   * filmMsOfMatchMs — an instant of the MATCH axis, read on the FILM axis. `matchMs −
   * originMs`. THIS IS THE 2D REPLAY'S SOLE SUBTRACTION: the media, the match join/leave,
   * the siege relays and the kill feed all do it, and writing it five times is what gave
   * rise to three different answers (P0-5).
   */
  filmMsOfMatchMs(matchMs: number): number
  /**
   * frameOfFilmMs — the FILM frame of a film instant, rounded to the nearest frame and
   * never negative: nothing plays before the zero frame.
   */
  frameOfFilmMs(filmMs: number): number
}

/**
 * matchClock returns the match clock, or `null` when it is not established: artifact without
 * an origin, without a time scale, or without two frames to put end to end.
 *
 * ONE VERDICT FOR A WHOLE PAGE: the surfaces that date something call it once and ALL of
 * them degrade the same way when it returns `null`. That is what the scattering of fallback
 * policies had broken (register 2026-09-05, P0-5/P0-7).
 */
export function matchClock(
  doc: MatchClockDocument | null | undefined,
  header: MatchClockHeader | null | undefined,
): MatchClock | null {
  if (!doc) return null
  const originMs = doc.originMs
  const frameIntervalMs = doc.frameIntervalMs
  if (originMs == null || !Number.isFinite(originMs)) return null
  if (!frameIntervalMs || !Number.isFinite(frameIntervalMs)) return null
  if (!(doc.frameCount > 1)) return null

  const t0Ms = Number.isFinite(header?.t0_ms) ? (header?.t0_ms as number) : 0
  const t0FilmMs = Number.isFinite(doc.t0FilmMs) ? (doc.t0FilmMs as number) : null
  // THE GAP BETWEEN THE TWO AXES, computed once: it is this, and only this, that both
  // conversions apply. Positive when the film starts BEFORE the kick-off (the ordinary case,
  // 18 to 28 s of countdown), negative on a film that starts after (witness e94163af: origin
  // 39 772 ms against a T0 of 35 238 ms, a 4.5 s lag).
  const filmToGameplayMs = originMs - t0Ms
  const gameplayMsOfFilmMs = (filmMs: number): number => filmMs + filmToGameplayMs
  return {
    originMs,
    t0Ms,
    t0FilmMs,
    frameIntervalMs,
    frameCount: doc.frameCount,
    gameplayMsOfFilmMs,
    gameplayMsOfFrame: (frame: number) => gameplayMsOfFilmMs(frame * frameIntervalMs),
    filmMsOfMatchMs: (matchMs: number) => matchMs - originMs,
    frameOfFilmMs: (filmMs: number) => Math.max(0, Math.round(filmMs / frameIntervalMs)),
  }
}
