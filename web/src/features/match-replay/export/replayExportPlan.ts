// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayExportPlan.ts — WHICH FRAMES THE EXPORT WILL PAINT, and at what moment in the file.
 *
 * # THE COMPUTATION THAT SEPARATES AN EXPORT FROM A RECORDING
 *
 * Real-time recording has nothing to decide: it films whatever goes by, and the number of
 * frames it gets depends on the machine's load. Export, instead, SAMPLES: it picks in advance
 * a sequence of match moments, evenly spaced, and fetches the replay's image at each one. This
 * module is what lays out that sequence.
 *
 * TWO TIME AXES, AND THEY MUST NEVER BE CONFUSED:
 *
 * - the DOCUMENT axis, in film frames (`frameIntervalMs` gives their real duration);
 * - the FILE axis, in microseconds, at a fixed rate (30 fps for the 2D map, `EXPORT_FPS`;
 *   60 fps for the 3D view, `EXPORT_FPS_3D`). Frame `i` sits at exactly `i / fps` s of match
 *   after the start, on both axes: that is what keeps the sound, mixed on match time, in sync.
 *
 * The two do NOT line up with each other: a film at 24.7 frames per second exported at 30
 * requires frames between the frames. That is not a problem — `draw()` accepts a FRACTIONAL
 * frame (this is already what the playback loop does, where `frameRef` advances by steps of
 * `dt * fps`) and interpolates the positions. Rounding here to the nearest whole frame would
 * produce jerky motion where the replay is smooth on screen.
 *
 * # WHY A PURE MODULE, AND NOT THREE LINES IN THE LOOP
 *
 * The frame count drives the progress bar, the announced duration and the memory used.
 * Computing it inside the loop would make it unverifiable; here, it is testable without a
 * browser, an encoder or a canvas.
 */
import { frameToMs, msToFrames } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { EXPORT_FPS } from './replayVideoEncoder'
import type { ReplayWindowBounds } from '../model/replayWindow'

/** The export's two bounds, on the DOCUMENT axis (frames, possibly fractional). */
export interface ExportBounds {
  startFrame: number
  endFrame: number
}

/**
 * MINIMUM HOLD DURATION of the last frame, in clip milliseconds, when the range reaches the
 * end of the match.
 *
 * WHY THIS HOLD EXISTS. The match-end screen is painted ONLY on the end bound, and sampling
 * only places ONE frame on that bound: the clip used to end on a 1/30 s flash of the verdict,
 * imperceptible — defeating the very goal `buildExportPlan` sets for itself. Three seconds are
 * enough to read a verdict and a score.
 */
export const END_HOLD_MS = 3000

/** The full plan: what the loop iterates over, and what the progress bar displays. */
export interface ExportPlan {
  /**
   * The document frames to paint, in order. Fractional: `draw()` interpolates. The index in
   * this array IS the file's frame number — that is what gives the timestamp, never the
   * value.
   */
  frames: number[]
  /** The produced file's frame rate, in frames per second. */
  fps: number
  /** Duration of the exported match RANGE, in milliseconds — never the computation's own. */
  durationMs: number
  /** Milliseconds the last frame is held, AFTER the range (0 = none). */
  holdMs: number
}

/**
 * defaultExportBounds — the range offered by default: the whole GAMEPLAY window.
 *
 * Without a window (an old artifact, a header with no playable duration), it falls back to
 * the whole film: less accurate — the pre-match countdown and the tail are in it — but it is
 * everything the document allows us to claim, and refusing the export would be worse.
 */
export function defaultExportBounds(
  doc: ReplayDocumentReady,
  playWindow: ReplayWindowBounds | null,
): ExportBounds {
  if (playWindow) return { startFrame: playWindow.startFrame, endFrame: playWindow.endFrame }
  return { startFrame: 0, endFrame: Math.max(doc.frameCount - 1, 0) }
}

/**
 * clampExportBounds brings bounds back inside the allowed domain and restores their order.
 *
 * THE BOUNDS COME FROM THE USER (two dialog fields): they can cross them, push them outside
 * the match, or ask for an empty range. None of these three cases is an error to report back
 * to them — they are gestures, and a gesture gets bounded.
 */
export function clampExportBounds(
  wanted: ExportBounds,
  domain: ExportBounds,
): ExportBounds {
  const lo = Math.min(domain.startFrame, domain.endFrame)
  const hi = Math.max(domain.startFrame, domain.endFrame)
  const a = Math.min(Math.max(wanted.startFrame, lo), hi)
  const b = Math.min(Math.max(wanted.endFrame, lo), hi)
  return { startFrame: Math.min(a, b), endFrame: Math.max(a, b) }
}

/**
 * buildExportPlan lays out the sequence of frames to paint.
 *
 * THE LAST FRAME IS ALWAYS EXACTLY THE END BOUND — and that is a decision, not a side effect
 * of the loop. Regular sampling almost always lands BEFORE the bound (the range is rarely an
 * exact multiple of 1/30 s); stopping there would cut the clip right before the match-end
 * screen, which is painted ONLY on that bound. A match-end clip without its end screen would
 * be the one flaw everybody would notice.
 *
 * An empty or degenerate range (equal bounds, a document with no time scale) renders ONE
 * frame: a one-frame clip is a freeze-frame, which is still a result; zero frames would be an
 * empty file the browser would download anyway.
 */
export function buildExportPlan(
  bounds: ExportBounds,
  doc: ReplayDocumentReady,
  fps: number = EXPORT_FPS,
  /**
   * Hold of the LAST frame after the range. The caller computes it: it is at least
   * `END_HOLD_MS` when the range reaches the end of the match, and at least the sound's tail
   * (an end fanfare lasts up to 11 s) — without which the sound track would keep playing on a
   * player with no frame left to show.
   */
  holdMs = 0,
): ExportPlan {
  const startMs = frameToMs(bounds.startFrame, doc)
  const endMs = frameToMs(bounds.endFrame, doc)
  const durationMs = Math.max(endMs - startMs, 0)
  const stepMs = 1000 / fps
  // `floor`, not `round`: one frame more than the range would overshoot the clip past the
  // requested bound, and the last frame is placed on the exact bound anyway.
  //
  // THE EPSILON IS NOT SUPERSTITION. `1000 / 30` does not come out even in binary:
  // `2000 / (1000 / 30)` equals 59.999999999999996, not 60, so `floor` used to return 59 — one
  // frame short exactly when the range is an exact multiple of the rate, which is the most
  // common case. The tolerance makes the count predictable without ever overshooting: it is a
  // thousand times smaller than one frame.
  const steps = Math.max(Math.floor(durationMs / stepMs + 1e-9), 0)
  const frames: number[] = []
  for (let i = 0; i < steps; i++) {
    frames.push(bounds.startFrame + msToFrames(i * stepMs, doc))
  }
  frames.push(bounds.endFrame)
  // THE HOLD REPEATS THE LAST FRAME: it is already painted, so the only cost is its own
  // encoding (an identical frame compresses to almost nothing).
  const held = Math.max(Math.floor(holdMs / stepMs + 1e-9), 0)
  for (let i = 0; i < held; i++) frames.push(bounds.endFrame)
  return { frames, fps, durationMs, holdMs: Math.max(holdMs, 0) }
}

/**
 * exportProgressPct — the share covered so far, as a bounded percentage.
 *
 * Here and not in the component: same rule as `writeCursor` for the timeline — a share
 * computed in two places eventually diverges, and a progress bar that goes past 100% is the
 * kind of detail that makes people doubt the rest.
 */
/**
 * Below this remainder, the estimate is no longer useful: it says "we're almost there", which
 * the bar already shows. Seen in acceptance testing on 2026-08-28 — on a fast export, it
 * displayed "environ 0:00 restantes" for its entire duration, which reads as "it's done" while
 * it is still running.
 */
const ETA_SHOW_MIN_MS = 3000
/** Past one minute, `m:ss`; below it, SECONDS — "0:07" reads worse than "7 s". */
const ETA_MINUTE_MS = 60_000

/**
 * etaLabel formats the remaining time, or returns `null` when nothing should be shown.
 *
 * `null` covers TWO cases that must not be confused: the estimate not yet reliable (the
 * caller has nothing to give us) and the estimate having become useless (under three
 * seconds).
 */
export function etaLabel(ms: number | undefined): string | null {
  if (ms === undefined || !Number.isFinite(ms) || ms < ETA_SHOW_MIN_MS) return null
  if (ms < ETA_MINUTE_MS) return `${Math.round(ms / 1000)} s`
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

export function exportProgressPct(done: number, total: number): number {
  if (total <= 0) return 0
  return Math.min(100, Math.max(0, (done / total) * 100))
}
