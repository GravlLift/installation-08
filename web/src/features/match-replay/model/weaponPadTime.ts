// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * weaponPadTime.ts — WHAT THE FILM SAYS ABOUT A PEDESTAL AT AN INSTANT: its occupancy, its
 * state, and the time left before the weapon comes back.
 *
 * WHY THIS FILE EXISTS, separate from the layer: this reading is PURE TIME, not drawing.
 * It serves the stroke, the hover and the tooltip — three callers for a single rule — and
 * it needs no canvas, no ink, no pixel density. Extracted from `weaponPadsLayer.ts` on
 * 2026-08-27, when the countdown gained its second source (D3) and the layer had passed the
 * repo's size threshold.
 *
 * THREE STATES, AND THE THIRD IS THE HONESTY OF THE MEASUREMENT. An occupancy publishes
 * three instants: `t0` the appearance (measured), `tLow` the last instant where the weapon
 * is PROVEN present, `tHigh` the first where its absence is proven. Between the two, the
 * film says nothing — the keyframes are spaced ~20 s apart. A state that would flip exactly
 * at an instant would assert a dating the source does not have: the interval is therefore
 * called UNCERTAIN and reads as such on screen.
 *
 * THE PICKER IS NOT HERE, and it will not be: the field exists in the contract
 * (`padPickups[].xuid`) and has been PUBLISHED since schema 30 (2026-08-31) — the native
 * event carries it. This module does not read it: it only computes instants.
 * No line of this file reads it.
 */
import type { ReplayWeaponPadReady } from '../../../lib/replay/replayNormalize'
import { respawnAt, type Respawn } from './respawnCountdown'

/**
 * The state of a pedestal at an instant: full (presence proven), uncertain (the film says
 * nothing), empty (absence proven). `empty` also covers the before-first-appearance.
 */
export type PadState = 'full' | 'uncertain' | 'empty'

/**
 * padOccupancyIndexAt — the RANK of the current occupancy, or -1 before the first.
 *
 * THE RANK AND NOT THE OCCUPANCY, because the countdown needs the NEXT one: since D3
 * (2026-08-27) it targets the next MEASURED appearance, and it is only reached knowing
 * where one is in the list.
 */
function padOccupancyIndexAt(pad: ReplayWeaponPadReady, frame: number): number {
  let found = -1
  for (let i = 0; i < pad.presence.length; i++) {
    if (pad.presence[i].t0 > frame) break
    found = i
  }
  return found
}

/**
 * padOccupancyAt — the current occupancy at this frame, that is the LAST one whose
 * appearance has taken place. Null before the first: the pedestal then carried nothing at
 * all.
 */
export function padOccupancyAt(
  pad: ReplayWeaponPadReady,
  frame: number,
): ReplayWeaponPadReady['presence'][number] | null {
  const i = padOccupancyIndexAt(pad, frame)
  return i < 0 ? null : pad.presence[i]
}

/**
 * padStateAt — the state of the pedestal at this frame.
 *
 * THE ORDER OF THE COMPARISONS IS the rule: full while the presence is proven, uncertain
 * while the absence is not, empty afterwards.
 *
 * THE "NEVER EMPTY" CASE IS APART, and it is frequent (8 occupancies out of 28 on one of
 * the witnesses): when the weapon is still recorded at the LAST keyframe, `tHigh` does not
 * exceed `tLow` — no absence has ever been proven. The pedestal then stays FULL to the end.
 * Writing it empty, even for one frame, would assert a pickup that nothing observed.
 */
export function padStateAt(pad: ReplayWeaponPadReady, frame: number): PadState {
  const occ = padOccupancyAt(pad, frame)
  if (!occ) return 'empty'
  if (frame < occ.tLow || occ.tHigh <= occ.tLow) return 'full'
  return frame < occ.tHigh ? 'uncertain' : 'empty'
}

/**
 * The countdown, AND WHERE IT COMES FROM — the second half of the information (D3,
 * 2026-08-27).
 *
 * `measured` distinguishes two figures that nothing separated on screen: the next
 * appearance SEEN IN THE FILM (exact, the replay knows the rest) and the one the CYCLE
 * predicts (an average, which can land off). The layer does nothing with it — an empty
 * pedestal stays an empty pedestal — but the tooltip says it, and that is where the
 * reservation must be read.
 */
export type PadRespawn = Respawn

/**
 * padRespawnAt — the seconds remaining before the re-appearance, and their provenance, or
 * null.
 *
 * THE ORDER OF THE SOURCES IS THE RULE (D3, user feedback of 2026-08-27: « compteur pas
 * toujours visible » [counter not always visible]): the replay knows THE REST OF THE FILM,
 * so the next measured appearance always beats the prediction. The cycle now serves only
 * for the LAST hole, the one no appearance closes. Without one or the other: nothing — a
 * dash would suggest one knows.
 *
 * WHAT THAT CHANGES, AND IT WAS THE REPORTED DEFECT: the count was displayed ONLY on the
 * pedestals with an established cycle (24 out of 57 do not carry one), so never on half
 * the map, even when the film showed the weapon coming back. It is now displayed on ALL
 * holes closed by an appearance, cycle or not.
 *
 * TWO UNCHANGED CONDITIONS: the pedestal is EMPTY (before `tHigh`, nothing is over) and
 * the count is not exhausted. For the predictive fallback, the start stays `tHigh`, the
 * UPPER bound of the disappearance: starting from `tLow` would advance the prediction by
 * an interval the source does not date.
 */
export function padRespawnAt(
  pad: ReplayWeaponPadReady,
  frame: number,
  frameMs: number,
): PadRespawn | null {
  if (padStateAt(pad, frame) !== 'empty') return null
  const i = padOccupancyIndexAt(pad, frame)
  if (i < 0) return null
  // THE RULE ITSELF LIVES IN `respawnCountdown.ts` SINCE LOT 5.8: the vehicle spawn
  // placements (schema 63) ask the document the SAME question, and two copies of the order
  // of the sources would have diverged without any screen showing it (CLAUDE.md n°6). What
  // remains here is what this file alone knows how to say: what "occupied" means for a
  // pedestal, and which fields the three numbers come from.
  //
  // `next.t0 > frame` BY CONSTRUCTION (the current occupancy is the last one whose
  // appearance has taken place): the measured count is always positive.
  return respawnAt(frame, frameMs, {
    nextSpawn: pad.presence[i + 1]?.t0 ?? null,
    emptySince: pad.presence[i].tHigh,
    medianS: pad.cycle?.medianS,
  })
}
