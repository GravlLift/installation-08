/**
 * riftStations.ts — WHERE THE RIFT IS, AND UNTIL WHEN.
 *
 * THE TRANSLOCATOR IS A ROUND TRIP, not a beacon placed once. The beacon EXCHANGES its
 * position with the player at each usage: the arrival of a jump is the departure of the previous one, to
 * 0.09 m near on the measurement (report R1 §4.4, on `1b2d9e08` slot 560). After an exchange, the
 * rift is therefore AT THE DEPARTURE POINT of that jump — `fx/fy` of the event 117, read in
 * the executable and validated at 0.00-0.26 m on 18 events (report R6 §1). An interface that
 * would draw « a rift placed once, fixed » would be FALSE.
 *
 * THE RIFT APPEARS AT ITS POSE, AT ITS PLACE (schema 98). The film dates the pose (`riftPoses`: the energy
 * of the carried translocator falls to zero) and, in the same packet, CREATES the rift: its position is that
 * of this object (`src` « object »; fallback « carrier »: the track of the carrier at the frame of the pose). It
 * depends on no exchange. A pose without position (neither of the two readable) draws nothing.
 *
 * THE RIFT ENDS AT THE READ DELETION OF ITS OBJECT (schema 98). The film writes the deletion of
 * the object that the pose created, and the server publishes it on the pose (`riftPoses[].t1`): the rift lives
 * from its pose until there, exchanges included, without looking at neither the consumption nor the death of the carrier.
 *
 * FALLBACK, when this end is not read (pose without `t1`, counted on the server in
 * `coverage.carriedEquipment.riftEndsUnread`, or an exchange that no read pose governs): NOTHING
 * STAYS FOR GOOD (user point of 2026-09-03). The end of the equipment has two measured modes —
 * the exhaustion by the final use (`spent` quasi simultaneous) and the expiration 9 to 16.5 s after the
 * last exchange — and the death of the carrier also closes, without `spent`. The last station then stops
 * at the first of these facts, never at the end of the replay.
 *
 * No React, no color, no canvas: dated geometry, testable alone.
 */
import { trackWindow } from '../../../lib/replay/replayLogic'
import { identityIsUnknown, translocatorRanks } from './placementTeleport'
import type { ReplayDocumentReady, ReplayTrackReady } from '../../../lib/replay/replayNormalize'
import { covers } from './replaySpans'

/**
 * RiftStation — THE RIFT AT A POSITION, during an interval of frames.
 *
 * A same life produces as many as situated exchanges: each exchange moves the rift to
 * the point it leaves, and closes the previous station. The last one carries the measured end.
 */
export interface RiftStation {
  /** Slot of the life that carries the translocator — the rift is to it. */
  slot: number
  /** First frame where the rift is here: that of the exchange that puts it there. */
  t0: number
  /** Last frame where it is there (inclusive): the next exchange, or the measured end. */
  t1: number
  x: number
  y: number
}

/** A SITUATED exchange of a life: the frame, and the point that the player leaves. */
interface Echange {
  frame: number
  x: number
  y: number
}

/**
 * riftStations — the stations of all the rifts of the film, in the order of the frames.
 *
 * A sweep per document, never per frame: the callers memoize it (same rule as
 * the pose counts).
 */
export function riftStations(doc: ReplayDocumentReady): RiftStation[] {
  const ranks = translocatorRanks(doc.abilityLabels)
  const parSlot = new Map<number, Echange[]>()
  for (const t of doc.translocations) {
    // THE POSITIONS ARE JOINTLY BOUND to the contract, and without them there is nothing to situate: the
    // gesture stays dated on the card (`translocationMoments`), the map goes silent.
    if (t.fx === undefined || t.fy === undefined) continue
    const liste = parSlot.get(t.slot) ?? []
    liste.push({ frame: t.t, x: t.fx, y: t.fy })
    parSlot.set(t.slot, liste)
  }
  const out: RiftStation[] = []
  for (const [slot, echanges] of parSlot) {
    echanges.sort((a, b) => a.frame - b.frame)
    for (let i = 0; i < echanges.length; i++) {
      const e = echanges[i]
      // EACH STATION IS BOUNDED FOR ITS OWN ACCOUNT, and not only the last
      // (correction of 2026-09-03, review round 1, finding K1). Bounding it by the sole exchange
      // next left an intermediate station surviving to the MEASURED end of its
      // equipment (a `spent` between two exchanges) and — worse — to the DEATH of its carrier,
      // into the life of the next player on the same slot. The first of the three facts
      // closes: the next exchange, the consumption, the death.
      const suivant = i + 1 < echanges.length ? echanges[i + 1].frame - 1 : Number.MAX_SAFE_INTEGER
      const t1 = Math.min(suivant, finDeLaFaille(doc, slot, e.frame, ranks))
      if (t1 < e.frame) continue
      out.push({ slot, t0: e.frame, t1, x: e.x, y: e.y })
    }
  }
  out.push(...stationsDesPoses(doc, parSlot, ranks))
  out.sort((a, b) => a.t0 - b.t0)
  return out
}

/**
 * finDeLaFaille — WHEN THE RIFT PRESENT AT THIS FRAME EXTINGUISHES, the next exchange set aside.
 *
 * The pose that governs it is the last pose of the slot at this frame or before, whose object lives
 * still (read end posterior, or not read): its READ end (`t1`) is truth. Without a governing pose, or
 * without a read end, the fallback [stationEnd] (consumption, death of the carrier).
 */
function finDeLaFaille(
  doc: ReplayDocumentReady,
  slot: number,
  frame: number,
  ranks: ReadonlySet<number>,
): number {
  let pose: ReplayDocumentReady['riftPoses'][number] | undefined
  for (const p of doc.riftPoses) {
    if (p.slot !== slot || p.t > frame) continue
    if (p.t1 !== undefined && p.t1 !== null && p.t1 < frame) continue
    if (pose === undefined || p.t > pose.t) pose = p
  }
  if (pose?.t1 !== undefined && pose.t1 !== null) return pose.t1
  return stationEnd(doc, slot, frame, ranks)
}

/**
 * stationEnd — THE FALLBACK: when the rift extinguishes for lack of a read end of its object.
 *
 * TWO MEASURED FACTS, AND THE FIRST OF THE TWO WINS:
 *  - the CONSUMPTION of the equipment (`spent` of the equipment layer, at the rank of the
 *    translocator) — whether it is read by the strict sweep or RECOVERED (`recovered`), the
 *    certification comes from the counter witness and not from the path (schema 38, decision D1):
 *    a recovered one is therefore worth exactly a strict one, and nothing here devalues it;
 *  - the DEATH OF THE CARRIER (end of the life THAT COVERS this exchange), which closes without `spent`.
 *
 * ONE ONLY LOOKS AT THE `spent` FROM THIS EXCHANGE ON: an earlier `spent` consumed an
 * equipment that the current rift does not know. And the death bound being that of the life
 * that covers the exchange, a `spent` of a LATER life of the same slot falls out of window of
 * itself — it cannot close a rift that already disappeared with its carrier.
 *
 * A `from` UNDER A COUNTER JUMP CLOSES NOTHING (`identityIsUnknown`): it says neither that
 * it is the translocator that exhausts nor that it does not. One then falls back on the death of the
 * carrier — a later bound, but MEASURED, rather than a closure affirmed wrongly.
 * It is the price, written, of the rule P2.4.
 */
function stationEnd(
  doc: ReplayDocumentReady,
  slot: number,
  echange: number,
  ranks: ReadonlySet<number>,
): number {
  let fin = lifeEnd(doc.tracks, slot, echange)
  for (const c of doc.equipmentChanges) {
    if (c.slot !== slot || c.kind !== 'spent') continue
    // At the frame itself of the exchange, it is the exhaustion by the final use (measured mode no. 1) —
    // it closes. `c.t > fin` sets aside both the after-death and the `spent` already out-ranked by
    // an earlier one: the loop therefore converges to the FIRST, whatever the order of the
    // array.
    if (c.t < echange || c.t > fin) continue
    if (identityIsUnknown(c) || !ranks.has(c.from)) continue
    fin = c.t
  }
  return fin
}

/**
 * lifeEnd — the last frame of the life that occupies this slot at the instant of this exchange.
 *
 * THE SEARCH IS ON THE LIFE THAT COVERS THE EXCHANGE, not on the slot alone: a biped slot
 * is re-allocated between the rounds, and taking « the last track of this slot » would make
 * a rift survive through the death of its carrier, into the life of another player. Without a
 * covering life — a case that should not exist, the server only publishing the slots with track — one
 * stops at the exchange itself: nothing draws rather than a rift without end.
 */
function lifeEnd(tracks: readonly ReplayTrackReady[], slot: number, frame: number): number {
  for (const t of tracks) {
    if (t.slot !== slot) continue
    const w = trackWindow(t)
    if (frame >= w.start && frame <= w.end) return w.end
  }
  return frame
}

/** riftStationAt — the active station of this rift at this frame, if there is one. */
export function riftStationsAt(
  stations: readonly RiftStation[],
  frame: number,
): RiftStation[] {
  return stations.filter((s) => covers(s, frame))
}

/**
 * stationsDesPoses — the rift between its POSE and the first exchange that follows: at the position of the
 * pose (the rift that the film creates at that instant, published by the server), until the frame preceding
 * the exchange, or until the end of the rift if it falls before ([finDeLaFaille]: the read deletion of
 * its object, otherwise the fallback) — without exchange, until that end. A pose without position draws nothing.
 */
function stationsDesPoses(
  doc: ReplayDocumentReady,
  echanges: ReadonlyMap<number, Echange[]>,
  ranks: ReadonlySet<number>,
): RiftStation[] {
  const out: RiftStation[] = []
  for (const p of doc.riftPoses) {
    if (p.x === undefined || p.y === undefined) continue
    const suivant = (echanges.get(p.slot) ?? []).find((e) => e.frame >= p.t)
    const avantEchange = suivant ? suivant.frame - 1 : Number.MAX_SAFE_INTEGER
    const t1 = Math.min(avantEchange, finDeLaFaille(doc, p.slot, p.t, ranks))
    if (t1 < p.t) continue
    out.push({ slot: p.slot, t0: p.t, t1, x: p.x, y: p.y })
  }
  return out
}
