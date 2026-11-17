// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * respawnCountdown.ts — THE COUNTDOWN OF A PLACE THAT RESTOCKS, and the ORDER OF ITS
 * TWO SOURCES.
 *
 * WHY THIS FILE EXISTS (CLAUDE.md no. 6, and the request of batch 5.8). Two layers ask the
 * SAME question to the document: « this place is empty, in how long does its object come back? ».
 * The WEAPON PADS ask it since 2026-08-27 (`weaponPadTime.padRespawnAt`); the
 * VEHICLE SPAWN SLOTS ask it since schema 63 (`vehicleCycleTime`). The
 * answer rule is the same down to the comma, and two copies would have diverged at the first
 * adjustment — the gap being invisible (a plausible number stays plausible).
 *
 * THE ORDER OF THE SOURCES IS THE RULE, AND IT COMES FROM A MEASUREMENT (D3, user feedback of
 * 2026-08-27: « counter not always visible »): THE REPLAY KNOWS THE REST OF THE FILM, so a
 * spawn ALREADY SEEN always beats what a cycle PREDICTS. The cycle serves only for the
 * LAST hole, the one that no spawn re-closes.
 *
 * WITHOUT SOURCE, NOTHING — neither zero nor dash: a dash would suggest that one knows (verdict of the pads layer,
 * taken as is).
 *
 * THIS FILE KNOWS NEITHER PAD NOR VEHICLE, and it is what makes it shareable: it only reads
 * three numbers. The question « is this place empty? » and that of « since when » stay
 * on the caller side, which alone knows what occupying means for its object.
 */

/**
 * The countdown AND ITS PROVENANCE.
 *
 * `measured` distinguishes two figures that nothing separated on the screen: the next spawn
 * SEEN IN THE FILM (exact) and the one the CYCLE predicts (an average, which can fall off).
 * The card does nothing with it — an empty place stays an empty place — but the tooltip says it, and it is
 * there that the reservation must be read (the « ≈ » of the labels).
 */
export interface Respawn {
  seconds: number
  measured: boolean
}

/** The three numbers the rule needs, and nothing more. */
export interface RespawnSources {
  /**
   * The frame of the NEXT spawn that the film shows, or `null` when none re-closes the
   * hole. A value that would not be in the future of the current frame is ignored: the
   * measured count is always positive, never a disguised negative number.
   */
  nextSpawn: number | null
  /**
   * The frame SINCE WHICH the place is empty, and it must be DATED by the source. For a
   * pad it is `tHigh`, the HIGH bound of the disappearance (starting from `tLow` would advance the
   * prediction by an interval that the film does not date); for a vehicle it is `tEnd`, the only
   * end that the film writes. `null`: nothing to predict from.
   */
  emptySince: number | null
  /** The median of the cycle, in seconds, when it is ESTABLISHED. `undefined` otherwise. */
  medianS: number | undefined
}

/**
 * respawnAt — the seconds remaining before the respawn, and their provenance, or `null`.
 *
 * THE CALLER HAS ALREADY RULLED THAT THE PLACE IS EMPTY: this function does not verify it, it would
 * not know how. It refuses in return a null or negative frame duration (a document
 * without cadence) and an exhausted count — in both cases there is nothing to announce.
 */
export function respawnAt(frame: number, frameMs: number, src: RespawnSources): Respawn | null {
  if (!(frameMs > 0)) return null
  if (src.nextSpawn !== null && src.nextSpawn > frame) {
    return { seconds: ((src.nextSpawn - frame) * frameMs) / 1000, measured: true }
  }
  if (src.emptySince === null || !(src.medianS !== undefined && src.medianS > 0)) return null
  const left = src.medianS - ((frame - src.emptySince) * frameMs) / 1000
  return left > 0 ? { seconds: left, measured: false } : null
}
