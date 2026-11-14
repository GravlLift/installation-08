/**
 * grapple3d_logic.ts — THE GRAPPLESHOT AT A FRAME: how far the hook has flown toward its anchor,
 * and whether it holds.
 *
 * THE SOURCE is the document: `grappleLines[]`, one pull per entry, the window [t0, t1] from the
 * FIRE (or the attach when the fire was not read) to the ARRIVAL measured on the carrier's
 * trajectory, and the anchor point. Between the two the hook travels and the cable pulls; the
 * carrier's own movement toward the anchor is his track, nothing is added to it.
 *
 * THE FLIGHT OF THE HOOK is the measured gap between the fire and the attach: the decoder reads
 * the pair 0.150 s apart, constant over its three witness films (p10 = p50,
 * `third_party/film-decoder/replay/grapple_lines.go`). The document does not say per line whether
 * its `t0` is a fire or an attach; on the local corpus every published pull has its fire read
 * (coverage `lightReads - unpairedFires == pulls`), so the window opens at the fire. A pull whose
 * fire was not read starts at the attach, and its hook would then land one flight late.
 *
 * A function of the frame alone: seeking backwards or forwards gives the same picture.
 */

/** The hook's flight from the hand to the anchor (ms): the fire-to-attach gap the decoder measures. */
export const GRAPPLE_HOOK_FLIGHT_MS = 150

/** A pull as the document publishes it (the fields this module reads). */
export interface GrapplePull {
  t0: number
  t1: number
}

/** The grapple at one frame. */
export interface GrapplePhase {
  /** Part of the way from the hand to the anchor the hook has flown, in [0, 1]. */
  reach: number
  /** The hook holds the anchor: the cable is taut and pulls. */
  attached: boolean
}

/**
 * grapplePhaseAt — the hook's progress at `frame`, or null outside the pull (before the fire,
 * after the arrival, or an empty window). The flight never outlasts the pull: a pull shorter than
 * the measured flight lands its hook at the arrival.
 */
export function grapplePhaseAt(pull: GrapplePull, frame: number, frameMs: number): GrapplePhase | null {
  if (!(pull.t1 > pull.t0) || frame < pull.t0 || frame > pull.t1) return null
  const flight = frameMs > 0 ? Math.min(GRAPPLE_HOOK_FLIGHT_MS / frameMs, pull.t1 - pull.t0) : 0
  const reach = flight > 0 ? Math.min(1, (frame - pull.t0) / flight) : 1
  return { reach, attached: reach >= 1 }
}
