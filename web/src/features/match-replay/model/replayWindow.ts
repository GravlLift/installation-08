/**
 * replayWindow — THE GAMEPLAY WINDOW: where the MATCH starts and where it ends on the axis of the film.
 *
 * THE FILM OVERFLOWS THE MATCH ON BOTH SIDES. Before, it carries the pre-match countdown (the
 * players are already there, frozen at their appearance); after, it keeps a tail of 5 to 6 seconds
 * (measured: 6.1 / 6.1 / 6.1 / 5.2 s on the four witnesses) — not the complete outro, just what
 * the recording had time to catch. Read end to end, the replay therefore started
 * on statues and ended on a scene that no longer belongs to the match.
 *
 * TWO AXES, AND IT IS THE WHOLE DIFFICULTY. The film counts in FRAMES since its first packet
 * of position (the ORIGIN that the clock of the page carries — schema >= 4 — says at what time of
 * the match this frame zero falls); the match, it, counts in ms since its `start_time` (`header.t0_ms` =
 * kickoff, `header.playable_duration_seconds` = game duration). Going from one to the other
 * is a subtraction, and the two bounds follow from it:
 *
 *     start = max(0, t0_ms − originMs)                     (clamp, cf. below)
 *     end   = t0_ms + playable_duration_seconds × 1000 − originMs
 *
 * THE END STAYS RIGHT WITHOUT `t0_ms`, and it is not luck: the server computes
 * `playable_duration_seconds` as `duration_seconds − t0_ms/1000` when the T0 is known
 * (match_view_builders_header.go), so the anchoring compensates itself — the
 * residual error is the truncation to the second. A match without T0 therefore keeps its framed end, and
 * starts at the first packet.
 *
 * THE CLAMP OF THE START IS NOT DEFENSIVE: on the witness e94163af, the first position packet
 * arrives 4.5 s AFTER the kickoff (originMs 39 772 > t0_ms 35 238). The film has nothing to
 * show before its own frame zero.
 *
 * TWO SOURCES FOR THE KICKOFF, AND THE FILM COMES FIRST (D5 of the T0-film plan, 2026-09-02).
 * `header.t0_ms` is ESTIMATED from the `first_joined_time` of the API: degenerate (~0 ms) on 10 to 15 %
 * of the matches, and offset by a full hour on a share of the corpus (historical TZ debt).
 * `doc.t0FilmMs` is MEASURED in the film — the instant of the first real movement of the players,
 * detected per match, without a hard constant. The measurement decides: dispersion 9 752 ms for the
 * film against 12 764 ms for the API on the same corpus of 101 matches, and no
 * implausible value on the film side. The field is therefore preferred EVERYWHERE where it exists; its absence
 * (artifact prior to schema 36, or refusal of the detector) falls back to the API, without
 * degradation compared to before this batch.
 *
 * THE END BOUND, IT, STAYS ON `header.t0_ms`, and it is not an inconsistency: its
 * correctness does not come from the anchoring but from the COMPENSATION described above — the server
 * subtracted THAT t0 to produce `playable_duration_seconds`. Substituting the film T0
 * there would break the cancellation and move the end by the gap between the two clocks.
 *
 * THE PREAMBLE (`leadInFrame`) IS A COMFORT OF READING, NOT A FRAMING (D3, user 02/09):
 * the reading sets ONE second before the kickoff, in time to set the eyes on the
 * scene before the action starts. Nothing else moves — the displayed clock, the timeline and the
 * export bounds stay on `startMs` / `startFrame`, and the clock therefore reads 0:00 during this
 * preamble (floor of `displayClockMs`).
 *
 * THE END BOUND NEVER USES THE SCORE LAYER, and it is a measurement, not an opinion:
 * the last point of the score falls 1.5 to 1.6 s before the declared end on the three witnesses
 * won on the score — but 133 s before on 64e8adfa, which ended ON TIME. A bound drawn
 * from the score would amputate two minutes of play on that match without any test going red.
 *
 * NO DATA, NO FRAMING (D-A3): an artifact whose clock is not established
 * (`model/replayClock` — no published origin, no time scale, fewer than two
 * frames) or a header without playable duration renders `null`, and everything that reads this window
 * then falls back to the behavior of before this batch — whole film, film clock. An
 * incoherent window (end before start) renders `null` for the same reason: better the whole film
 * than a reading of a single frame.
 *
 * THE ORIGIN IS NO LONGER READ HERE (2026-09-05, P0-5): it comes from `replayClock`, the verdict
 * unique to the page — the same as that of the feed, the media, the presence and the seats.
 */
import type { MatchViewHeader } from '@/lib/api/types'

import { replayClock } from './replayClock'
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

/** What the window reads of the match header: the two bounds of the MATCH axis. */
export type ReplayWindowHeader = Pick<MatchViewHeader, 't0_ms' | 'playable_duration_seconds'>

/**
 * READING PREAMBLE, in milliseconds BEFORE the kickoff (D3, user 2026-09-02).
 *
 * One second: enough to see the scene settle before the action starts, without ever
 * giving back to see the pre-match countdown. It is NOT a displacement of the framing — the
 * gameplay window, the clock and the export only know `startMs` / `startFrame`.
 */
export const LEAD_IN_MS = 1000

/** The gameplay window, in the two units of the replay (frames for the timeline, ms for the clock). */
export interface ReplayWindowBounds {
  /**
   * First frame of the gameplay: the lower bound of the TIMELINE, the origin of the displayed clock
   * and the start of the export range. It is no longer the place where the reading SETS — that one
   * is `leadInFrame`, one second earlier.
   */
  startFrame: number
  /**
   * WHERE THE READING SETS, one second below the kickoff (`LEAD_IN_MS`) — never before
   * frame zero of the film. It is the ONLY bound that the preamble moves: the timeline starts
   * always from `startFrame`, and the clock displays 0:00 as long as the reading is below it.
   */
  leadInFrame: number
  /** Last frame of the gameplay: the reading stops there, the timeline does not go out of it. */
  endFrame: number
  /** Time of the kickoff on the axis of the film, in ms — the origin of the DISPLAYED clock. */
  startMs: number
  /** Time of the declared end on the axis of the film, in ms, bounded by the real duration of the film. */
  endMs: number
}

/**
 * replayWindow returns the gameplay window of the document, or `null` when it is not
 * established (cf. the header: artifact without origin, header without playable duration, bounds
 * incoherent). The frames are ROUNDED to the nearest frame: at a 100 ms interval,
 * truncating would cost up to one frame of gameplay at each end.
 */
export function replayWindow(
  doc: ReplayDocumentReady,
  header: ReplayWindowHeader | null | undefined,
): ReplayWindowBounds | null {
  const clock = replayClock(doc, header)
  const playableSeconds = header?.playable_duration_seconds
  if (!clock || playableSeconds == null) return null
  // The clock guarantees at least two frames: the last one therefore exists.
  const lastFrame = clock.frameCount - 1

  // THE T0 OF THE API serves the END bound, and it alone: it is it that the server subtracted
  // to produce `playable_duration_seconds` (cf. the header, § of the compensation).
  const apiT0Ms = clock.t0Ms
  // THE T0 OF THE START PREFERS THE FILM: measured at the first movement, against estimated from the
  // `first_joined_time`. Both are on the axis of the MATCH, the subtraction is the same.
  const startT0Ms = clock.t0FilmMs ?? apiT0Ms
  const startMs = Math.max(0, clock.filmMsOfMatchMs(startT0Ms))
  const filmEndMs = frameToMs(lastFrame, doc)
  const endMs = Math.min(clock.filmMsOfMatchMs(apiT0Ms + playableSeconds * 1000), filmEndMs)
  const startFrame = clampFrame(clock.frameOfFilmMs(startMs), lastFrame)
  const endFrame = clampFrame(clock.frameOfFilmMs(endMs), lastFrame)
  if (endFrame <= startFrame) return null
  const leadInFrame = clampFrame(clock.frameOfFilmMs(startMs - LEAD_IN_MS), lastFrame)
  return { startFrame, leadInFrame, endFrame, startMs, endMs }
}

/**
 * displayClockMs re-scales a time of the axis of the film onto the GAMEPLAY CLOCK (D-A2): the
 * kickoff reads 0:00, and the pre-match countdown is no longer counted. Floor at zero
 * — an event from before the kickoff (a death in pre-match) displays at 0:00 rather than in
 * negative. Without a window, the identity: the internal axis of the replay does not change, only the display.
 */
export function displayClockMs(ms: number, playWindow: ReplayWindowBounds | null): number {
  if (!playWindow) return ms
  return Math.max(0, ms - playWindow.startMs)
}

/** Bounds a frame in the film: neither before frame zero, nor after the last one. */
function clampFrame(frame: number, lastFrame: number): number {
  return Math.min(Math.max(frame, 0), lastFrame)
}
