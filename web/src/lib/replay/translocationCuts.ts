// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * translocationCuts — A TRANSLOCATION IS A CUT OF THE TRACK, NOT A MOVEMENT.
 *
 * THE DEFECT OBSERVED ON SCREEN (aj14-b, B0, film `1b2d9e08`, playback at 1×). A life's track
 * is sampled at every frame; the ARRIVAL sample of a translocation is found 3 to 20 m from
 * the previous one. Interpolated as an ordinary step, it gave two defects: the pawn SLID from
 * departure to arrival over one frame, and the trail drew a straight line between the two
 * points, held for its whole window — a movement no one made.
 *
 * WHAT THE MODULE SAYS. `translocations[]` (the film's event 117) carries the jump's two
 * positions (`fx/fy` -> `tx/ty`). The cut is set on the first arrival sample: the one whose
 * PREDECESSOR is at the departure and which itself is at the arrival. `replayLogic` reads it
 * as a replication gap for the position, the altitude and the trail (nothing interpolates
 * across it) but not for the drawing (`inGapAt` does not see it: the player is there, they
 * are not paled).
 *
 * WHY ONE SEARCHES THE SAMPLE PAIR AND DOES NOT GUESS IT. The event's frame is sometimes the
 * last frame at the departure, sometimes the first at the arrival (measured on the fleet of
 * 2026-10-14: 30 events out of 122 in the first case, 92 in the second). Only two candidates
 * are tried — the first sample at the event's frame or after, and the next one —, each
 * verified by the TWO published positions. No jump-distance threshold: a translocation can be
 * 50 cm. An event without positions, or whose pair does not match (1 out of 123 in the fleet:
 * the track stops before), cuts nothing — one does not invent a cut.
 */
import type { ReplayDocument } from '@/lib/api/types'

import type { ReplayCutPoint } from './replayReadyTypes'

/**
 * Maximum gap, in meters, between a published end of the jump and the sample that carries it.
 * Measured on the fleet's 122 paired events: 0.00 to 0.27 m at the departure, 0.00 to 1.39 m
 * at the arrival (the player moves during the frame); 2 m leaves the margin of one shifted
 * sample. A very short jump (0.48 m at the smallest) can pair two neighboring pairs: the cut
 * then falls between two nearly coincident samples, and moves nothing.
 */
export const CUT_TOLERANCE_M = 2

type Translocation = NonNullable<ReplayDocument['translocations']>[number]

/**
 * cutSampleIndex — the index of the ARRIVAL sample of THIS translocation in THIS track, or -1
 * when it is not readable there.
 */
export function cutSampleIndex(points: readonly ReplayCutPoint[], ev: Translocation): number {
  const { fx, fy, tx, ty } = ev
  if (fx === undefined || fy === undefined || tx === undefined || ty === undefined) return -1
  let k0 = -1
  for (let i = 0; i < points.length; i++) {
    if (points[i].t >= ev.t) {
      k0 = i
      break
    }
  }
  if (k0 < 0) return -1
  for (const k of [k0, k0 + 1]) {
    if (k <= 0 || k >= points.length) continue
    const a = points[k - 1]
    const b = points[k]
    if (Math.hypot(a.x - fx, a.y - fy) <= CUT_TOLERANCE_M && Math.hypot(b.x - tx, b.y - ty) <= CUT_TOLERANCE_M) {
      return k
    }
  }
  return -1
}

/**
 * markTranslocationCuts — sets `cut` on the arrival sample of each translocation.
 *
 * One life per track: a slot can carry several (reappearances), so one searches among those
 * of the slot. Tracks without a cut are returned AS-IS (same reference), the others receive a
 * fresh array — the contract's samples are never mutated.
 */
export function markTranslocationCuts<T extends { slot: number; points: ReplayCutPoint[] }>(
  tracks: readonly T[],
  translocations: readonly Translocation[],
): T[] {
  if (translocations.length === 0) return [...tracks]
  const cuts = new Map<T, Set<number>>()
  for (const ev of translocations) {
    for (const track of tracks) {
      if (track.slot !== ev.slot) continue
      const k = cutSampleIndex(track.points, ev)
      if (k < 0) continue
      const set = cuts.get(track) ?? new Set<number>()
      set.add(k)
      cuts.set(track, set)
      break
    }
  }
  return tracks.map((track) => {
    const set = cuts.get(track)
    if (!set) return track
    return { ...track, points: track.points.map((p, i) => (set.has(i) ? { ...p, cut: true as const } : p)) }
  })
}
