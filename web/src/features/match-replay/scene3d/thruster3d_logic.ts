/**
 * thruster3d_logic.ts — THE THRUSTER BURST: each measured thruster use, the direction it pushed
 * the carrier, and the state of its exhaust at a frame.
 *
 * THE SOURCE is the document: `abilityImpulses` (schema 38), one entry per gesture, family
 * `thruster` (validated 5/5 against a Theater reading, see `layers/thrusterDashFx.ts`). The impulse
 * dates the gesture and carries no direction; the direction is read in the carrier's trajectory
 * around the instant by the 2D rule (`buildThrusterDashFx`), and an impulse whose direction cannot
 * be read draws nothing. The timing is the 2D dash's (`dashProgress`, `THRUSTER_DASH_MS`).
 * A function of the frame alone: seeking gives the same picture.
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { buildThrusterDashFx, dashProgress, THRUSTER_DASH_HEADING_MS } from '../layers/thrusterDashFx'

/** One thruster use: its frame, the carrier's slot, and the horizontal direction of the push (unit, Halo axes). */
export interface ThrusterBurst {
  t: number
  slot: number
  dx: number
  dy: number
}

/** thrusterBursts — the thruster uses whose direction the trajectory gives, sorted by frame. */
export function thrusterBursts(doc: ReplayDocumentReady, frameMs: number): ThrusterBurst[] {
  if (!(frameMs > 0)) return []
  const out: ThrusterBurst[] = []
  for (const f of buildThrusterDashFx(doc, THRUSTER_DASH_HEADING_MS / frameMs)) {
    const dx = f.to.x - f.from.x
    const dy = f.to.y - f.from.y
    const len = Math.hypot(dx, dy)
    if (!(len > 0)) continue
    out.push({ t: f.frame, slot: f.slot, dx: dx / len, dy: dy / len })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** The exhaust at one frame: its length as a part of the full jet, and its presence, both in [0, 1]. */
export interface ThrusterJet {
  reach: number
  alpha: number
}

/** thrusterJetAt — the exhaust at `frame`, or null outside the gesture. */
export function thrusterJetAt(burst: ThrusterBurst, frame: number, frameMs: number): ThrusterJet | null {
  return dashProgress((frame - burst.t) * frameMs, false)
}
