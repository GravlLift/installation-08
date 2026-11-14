/**
 * replaySpans — « DOES THIS INTERVAL COVER THIS FRAME? », written once.
 *
 * WHY THIS MODULE EXISTS (register 2026-09-05, K5). The film dates everything that LASTS by a
 * pair of frames `{t0, t1}`: a carry of bomb, skull or flag, a period of
 * VIP, a vehicle occupancy, a rift station. The predicate « this interval covers
 * the current frame » was written TEN times, in two spellings depending on the author:
 *
 *     frame >= s.t0 && frame <= s.t1        s.t0 <= frame && frame <= s.t1
 *
 * The ten were in agreement — measured in adversarial verification (V-WEB-2): same convention,
 * closed at both ends. That is precisely what made the tenth copy easy to write
 * without thinking about it, and the eleventh easy to write WRONG: `<` instead of `<=` on `t1` makes
 * a glyph disappear at its last frame, which is not visible on any screen.
 *
 * CLOSED AT BOTH ENDS, AND IT IS A DECISION. `t1` is the LAST frame where the state holds,
 * not the first where it no longer does: a carry of a single frame has `t0 === t1` and must be
 * painted. The convention is that of the film, not a choice of convenience.
 */

/** What this predicate asks of an interval, and nothing more. */
export interface FrameSpan {
  t0: number
  t1: number
}

/** covers — does the interval contain the frame? Closed at both ends (cf. the header). */
export function covers(span: FrameSpan, frame: number): boolean {
  return frame >= span.t0 && frame <= span.t1
}

/** spansAt — the intervals of a list that cover the frame, in the order of the list. */
export function spansAt<T extends FrameSpan>(spans: readonly T[], frame: number): T[] {
  return spans.filter((s) => covers(s, frame))
}
