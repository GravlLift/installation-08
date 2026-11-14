/**
 * carriedGlyphPlace.ts — THE SINGLE RULE: where a CARRIED objective object is drawn when its
 * carrier has NO position at the served frame.
 *
 * THE FACT, MEASURED. A carrying period is an INTERVAL; the carrier's trajectory, for its part,
 * is a sequence of samples that can be interrupted (life not replicated, bipode replication hole).
 * The audit of 2026-09-10 counted these frames: **533 out of 32,464** for the flag
 * (1.64%, §3.5) and **694** for the Oddball skull (7.0% of the fleet, report 6.2 §2.1). The
 * carrying is TRUE on these frames — it is the position that is missing, not the fact.
 *
 * WHAT THE THREE LAYERS WERE DOING, AND WHAT WAS WRONG IN TWO DIFFERENT WAYS:
 *  - skull (`skullCarrierLayer`) and bomb (`bombCarrierLayer`): `if (!w) continue` — the object
 *    DISAPPEARS from the screen, while it is somewhere and the film knows it;
 *  - flag (`flagCarriesLayer`): fallback to `{x: now.x, y: now.y}`, THE SPAN'S ANCHOR — a
 *    EXPIRED position, drawn with the dressing of a CARRIED object. A falsely stationary object reads
 *    as a fact, which is worse than a hole.
 *
 * THE RULE, THE SAME FOR THE THREE: without a carrier position, the object is rendered **FREE at its
 * LAST KNOWN POSITION** — the carrier's last position since the start of the carrying, failing that
 * the object's last known rest (the caller serves it: skull pedestal, flag's span
 * anchor). « Free » is not an admission of ignorance: it is the only true thing one can
 * say — the object is at that spot, and no one is drawn underneath.
 *
 * WHY THE VISUAL STATE CHANGES, AND NOT ONLY THE POSITION. The « carried » dressing designates a
 * PLAYER: the flag's offset exists so as not to cover the carrier's piece
 * (`glyphIsOffset`), the skull sits above the marker. Without a carrier on screen, these
 * decorations point at nothing. The « free » dressing designates a PLACE, and that is what the
 * position served here has become.
 *
 * ONE GLYPH PER OBJECT AND PER FRAME, that is the invariant this rule protects: the state
 * returned here is EXCLUSIVE (`carried` XOR `free` XOR `absent`), and the free object layers plug
 * into it (cf. `skullPresenceAt`, carrying precedence) rather than each guessing on their
 * own. Two glyphs of the same object at the same frame would be two contradictory assertions.
 *
 * THE BACKWARD SWEEP NEVER LEAVES THE CARRYING: it stops at `t0`. Going beyond would serve
 * the position of BEFORE the pickup — that is, the last rest, which the caller already serves
 * explicitly if it knows it. Cost: the longest measured hole of the fleet fits in a few
 * tens of frames, and a carrying whose carrier is NEVER localizable exits on the first turn
 * by the fallback (null `xuid`) or at the end of a single sweep of the period.
 */
import type { XY } from '../../../lib/replay/replayLogic'

/** The position reading of a carrier at a frame — the one from `carrierPosition.ts`. */
export type CarrierPosAt = (xuid: string, frame: number) => XY | null

/**
 * CarriedGlyphPlace — where and HOW the object is drawn at this frame. The three states are
 * EXCLUSIVE: that is what forbids two glyphs of the same object at the same frame.
 */
export type CarriedGlyphPlace =
  /** The carrier is localizable: the object is drawn ON it, « carried » dressing. */
  | { state: 'carried'; at: XY }
  /** The carrier has no position: the object is drawn FREE, at its last known place. */
  | { state: 'free'; at: XY }
  /** No known position, neither of the carrier nor of the object: nothing is invented. */
  | { state: 'absent' }

/** The carrying reduced to what the rule needs: WHO carries, and SINCE WHICH frame. */
export interface CarriedSpan {
  /** The carrier. `null` = the artifact does not name it: no trajectory to reread. */
  xuid: string | null
  /** First frame of the carrying: bound of the backward sweep, never crossed. */
  t0: number
}

/**
 * carriedGlyphPlaceAt applies the rule, and it is the UNIQUE place it is written (guardrail:
 * `carriedGlyphPlace.guard.test.ts`).
 *
 * `fallback` is the last KNOWN REST of the object itself, served by the caller when it
 * knows one: skull pedestal, span anchor for the flag. `null` when the object has no
 * position channel of its own — that is the case of the bomb (`document_bomb_carries.go`: the
 * bomb object has no channel measured on the Go side).
 */
export function carriedGlyphPlaceAt(
  posOf: CarrierPosAt,
  span: CarriedSpan,
  frame: number,
  fallback: XY | null,
): CarriedGlyphPlace {
  const here = span.xuid ? posOf(span.xuid, frame) : null
  if (here) return { state: 'carried', at: here }
  const back = span.xuid ? lastKnownCarrierPos(posOf, span.xuid, span.t0, frame) : null
  if (back) return { state: 'free', at: back }
  return fallback ? { state: 'free', at: fallback } : { state: 'absent' }
}

/**
 * lastKnownCarrierPos goes back frame by frame from `frame - 1` down to `since` (inclusive) and returns the
 * first position found, or `null`. The step is the frame because it is the only unit the
 * layer knows — it never receives the document's clock.
 */
function lastKnownCarrierPos(
  posOf: CarrierPosAt,
  xuid: string,
  since: number,
  frame: number,
): XY | null {
  for (let f = frame - 1; f >= since; f -= 1) {
    const p = posOf(xuid, f)
    if (p) return p
  }
  return null
}
