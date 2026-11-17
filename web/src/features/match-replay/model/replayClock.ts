// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayClock — THE CLOCK OF THE REPLAY PAGE: ONE SINGLE VERDICT, ONE SINGLE POLICY.
 *
 * WHAT IT REPLACES (register 2026-09-05, P0-5). The same question — « at what time of
 * the match does frame zero of the film fall? » — received FIVE writings and THREE answers:
 * `replayWindow` returned `null`, the kill feed measured the offset by
 * pairing, and the media, the presence and the seats set `0`. On an artifact without
 * published origin (5 of the 106 local artifacts as of 2026-09-05), the Media track and the Kills track
 * therefore ended up on the SAME timeline at two different offsets: a capture and
 * the frag it shows could drift from the real origin of the film, measured from 3.6 s
 * to 50.8 s depending on the match.
 *
 * THE POLICY, IN ONE SENTENCE: the origin is the one the ARTIFACT PUBLISHES; without it, the
 * page has no clock and NO surface places anything on the axis of the film.
 *
 * WHY NOT `0` AS FALLBACK. It is the producer itself that writes it, in capitals, in
 * `internal/games/halo_infinite/film/replay/origin.go`: « ZERO IS NOT A NEUTRAL ORIGIN, IT IS A
 * FALLBACK ». It REFUSES to publish an origin it cannot establish (unreadable chunk,
 * contradictory witness) rather than invent one; recopying `0` on the client side amounts to
 * undoing that refusal and setting each mark at a wrong time — which reads as right.
 * `replayWindow` had already ruled thus (« NO DATA, NO FRAMING »); the four
 * other surfaces align.
 *
 * THE EXCEPTION IS NAMED, AND IT IS MEASURED: the kill feed. It alone has
 * a second source for the origin — the pairing of the kills to the ends of the lives of their
 * victims — and this measurement is braced (median +3 678 ms on 000d5950, +10 589 ms on
 * 64e8adfa, +39 856 ms on e94163af, within 20-70 ms of the published origin when both
 * exist, cf. the header of `killFeedLogic.ts`). It therefore keeps its measured fallback when
 * the clock is not established, and nothing else measures: a second surface that
 * would invent an origin would reintroduce exactly the flaw above.
 *
 * WHAT ESTABLISHES THE CLOCK DEPENDS ONLY ON THE ARTIFACT. The match header brings only the
 * countdown (`t0_ms`): it neither establishes nor destroys the clock, and two callers who do not
 * have the same header therefore get the SAME verdict. This is what allows this function
 * to be called where each surface is found, without the page having to circulate an
 * object — one single verdict by construction, not by discipline.
 *
 * THE CONVERSIONS, THEY, LIVE IN `lib/replay/matchClock`: this module only
 * sets the verdict of the replay page on top.
 */
import { matchClock, type MatchClock, type MatchClockHeader } from '@/lib/replay/matchClock'

import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'

/** What the clock reads of the match header: the countdown, and it alone. */
export type ReplayClockHeader = MatchClockHeader

/**
 * The clock of the replay, ESTABLISHED. It is `MatchClock` as is: the replay adds no
 * conversion, it adds a VERDICT — the object exists, or it does not.
 */
export type ReplayClock = MatchClock

/**
 * replayClock returns the clock of the page, or `null` when it is not established: artifact
 * without published origin, without time scale, or without two frames to put end to end.
 *
 * THREE DOORS, AND THREE MEASUREMENTS. The origin is missing on 5 of the 106 local artifacts (the five
 * carry `coverage.originResolved: false` — the producer refused to date them).
 * The time scale, it, is published by the 106, always at 100 ms: demanding it removes
 * nothing therefore, and on the contrary removes the two divergent fallbacks that lingered
 * (60 frames/s in `replayLogic`, 100 ms in `seatLogic`). A film of a single frame has
 * no axis.
 */
export function replayClock(
  doc: ReplayDocumentReady | null | undefined,
  header?: ReplayClockHeader | null,
): ReplayClock | null {
  return matchClock(doc, header)
}
