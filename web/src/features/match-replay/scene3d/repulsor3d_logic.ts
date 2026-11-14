/**
 * repulsor3d_logic.ts — THE REPULSOR PULSE: every activation of a carried repulsor, and how far its
 * burst has spread at a frame.
 *
 * THE SOURCE is the GESTURE, not its effect: `carriedEquipment[].uses`, the frames of the carried
 * repulsor's activations (i21, schema 95), the family read from its rank (`abilityLabels[r].family`,
 * the rule of `carriedUseSound`). A push into the void writes no `knockbacks` entry, but its
 * activation is on the carried object, so every pulse is drawn, with or without a pushed player.
 * On the local corpus each published push falls on an activation of its author within one frame.
 *
 * THE TIMING is the 2D push wave's (`knockbackFx.waveProgress`, `KNOCKBACK_FX_MS`): the burst
 * opens fast, then fades. Its reach is not in the document (see `REPULSOR_PULSE_RADIUS_U`).
 * A function of the frame alone: seeking gives the same picture.
 */
import type { ReplayDocumentReady } from '@/lib/replay/replayNormalize'

import { waveProgress } from '../layers/knockbackFx'

/** The repulsor's palette family (stable identifier of the document). */
export const REPULSOR_FAMILY = 'repulsor'

/**
 * The burst's final radius (u). ESTIMATE: the true reach is the repulsor's equipment tag, not in
 * the app. It covers the farthest pushed player measured on the local corpus (2.40 u from his
 * author at the push, 11 pushes on 3 films).
 */
export const REPULSOR_PULSE_RADIUS_U = 2.5

/** One activation: the frame and the carrier's slot (a life, read at that frame). */
export interface RepulsorPulse {
  t: number
  slot: number
}

/** repulsorPulses — every activation of every carried repulsor, sorted by frame. */
export function repulsorPulses(doc: Pick<ReplayDocumentReady, 'carriedEquipment' | 'abilityLabels'>): RepulsorPulse[] {
  const out: RepulsorPulse[] = []
  for (const c of doc.carriedEquipment) {
    if (doc.abilityLabels?.[String(c.r)]?.family !== REPULSOR_FAMILY) continue
    for (const t of c.uses) out.push({ t, slot: c.slot })
  }
  return out.sort((a, b) => a.t - b.t)
}

/** The burst at one frame: its radius (u) and its presence in [0, 1]. */
export interface RepulsorBurst {
  radius: number
  alpha: number
}

/** repulsorBurstAt — the pulse at `frame`, or null outside its window. */
export function repulsorBurstAt(pulse: RepulsorPulse, frame: number, frameMs: number): RepulsorBurst | null {
  const wave = waveProgress((frame - pulse.t) * frameMs, false)
  if (!wave) return null
  return { radius: REPULSOR_PULSE_RADIUS_U * wave.reach, alpha: wave.alpha }
}
