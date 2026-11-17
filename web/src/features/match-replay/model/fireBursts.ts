// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * fireBursts.ts — THE SHOTS OF A CONTINUOUS-FIRE BURST, PLACED THE WAY THEATER PLACES THEM (schema 71,
 * batch M4b of the replay returns).
 *
 * THE FILM DOES NOT WRITE THE INSTANT OF EACH SHOT of a continuous-fire weapon (Ghost, Banshee
 * cannons, Chopper, LMG, LAAG, turrets, Sentinel Ray): it writes the HELD trigger, at
 * the tick, in the control view. The game simulates the shots at the rate of the TAG of the weapon; the document
 * publishes the burst (`doc.bursts`: bounds, weapon, carrier vehicle, rate, silent passages) and this
 * module places the shots — the FIRST at the trigger pull, the following ones at the rate, rate ramp
 * included (LAAG: from 5 to 18 shots per second in 1.6 s). This is the server's calculation
 * (`replay/fire_bursts.go`, `instantsDesCoups`), and the count `coverage.continuousFire.shots` is
 * its check.
 *
 * THE SILENT PASSAGES (`holes`) carry NO shot: the read did not reach them, and
 * nothing authorizes supposing the trigger held in them (user decision of 2026-09-24).
 *
 * A SHOT BECOMES A SHOT OF THE DOCUMENT (`fireBurstShots`): same shape as `doc.shots` — frame,
 * shooter's slot, position, weapon, vehicle — so that the muzzle flash and the « ! » of the shooter
 * draw it like any shot. One shot per FRAME at most and per burst: beyond that (Sentinel Ray,
 * 60 shots per second), the flash re-triggers at each frame, which IS a beam.
 *
 * Pure: no React, no canvas.
 */
import { frameToMs } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady, ReplayFireBurstReady } from '../../../lib/replay/replayNormalize'
import { buildCarrierPosAt } from './carrierPosition'
import { buildLivesBySlot, lifeOfSlotAt } from './livesPosition'

/**
 * EPSILON_FRAME — the tolerance of the end bound: the shots accumulate in floats, and a shot
 * that falls EXACTLY on the last frame (60/s: 6 shots per frame) must not be lost
 * by the rounding. The same as the server's (`replay/fire_bursts.go`, `epsilonFrame`).
 */
const EPSILON_FRAME = 1e-6

/** A simulated shot of a burst, in the shape of a document shot. */
export interface FireBurstShot {
  t: number
  /**
   * Intra-frame offset (ms): absent for the simulated shots — the burst is placed over the whole frame
   * (one shot per frame at most), the document's offset does not exist for them.
   */
  o?: number
  slot: number
  x: number
  y: number
  w?: string
  v?: number
}

/**
 * burstShotFrames — the instants of the shots of a burst, in FRACTIONAL frames, outside its
 * silent passages. `frameIntervalMs` is the step of the document.
 */
export function burstShotFrames(b: ReplayFireBurstReady, frameIntervalMs: number): number[] {
  if (!(b.rate > 0) || !(frameIntervalMs > 0)) return []
  const parFrame = frameIntervalMs / 1000
  const out: number[] = []
  for (let t = b.t0; t <= b.t1 + EPSILON_FRAME; ) {
    if (!inHole(b, t)) out.push(t)
    const ecoule = (t - b.t0) * parFrame
    const monte = (b.rate0 ?? 0) > 0 && (b.ramp ?? 0) > 0 && ecoule < (b.ramp ?? 0)
    const cadence = monte
      ? (b.rate0 ?? 0) + ((b.rate - (b.rate0 ?? 0)) * ecoule) / (b.ramp ?? 1)
      : b.rate
    t += 1 / (cadence * parFrame)
  }
  return out
}

/** inHole says if an instant falls in a silent passage of the burst. */
function inHole(b: ReplayFireBurstReady, t: number): boolean {
  return b.holes.some((h) => t >= h.t0 && t < h.t1)
}

/**
 * fireBurstShots — the simulated shots of all the bursts, one per frame and per burst at most,
 * placed on the CARRIER VEHICLE (its position at that frame) or on the LIFE of the foot shooter. A
 * shot without position (vehicle without sample nor birth, life outside its window) is not placed:
 * it would be drawn nowhere.
 */
export function fireBurstShots(doc: ReplayDocumentReady): FireBurstShot[] {
  if (doc.bursts.length === 0) return []
  // THE POSITION IS THE CARRIER'S (`carrierPosition.ts`, the single path): embarked, the
  // vehicle it rides — at the same interpolation as the sprite; on foot, its bipode.
  const posOf = buildCarrierPosAt(doc)
  const bySlot = buildLivesBySlot(doc.tracks)
  const out: FireBurstShot[] = []
  for (const b of doc.bursts) {
    const xuid = xuidDuTireur(doc, bySlot, b)
    if (!xuid) continue
    let derniere = Number.NEGATIVE_INFINITY
    for (const t of burstShotFrames(b, frameToMs(1, doc))) {
      const frame = Math.floor(t + EPSILON_FRAME)
      if (frame === derniere) continue
      derniere = frame
      const pos = posOf(xuid, frame)
      if (!pos) continue
      out.push({ t: frame, slot: b.slot, x: pos.x, y: pos.y, w: b.w, v: b.v })
    }
  }
  return out.sort((a, b) => a.t - b.t)
}

/**
 * xuidDuTireur — the player of the burst: the life of its slot at the trigger pull, otherwise
 * the occupation episode of that slot on the carrier vehicle (an embarked shooter no longer replicates
 * its position, its life may have closed before). Without a name, the burst is not placed.
 */
function xuidDuTireur(
  doc: ReplayDocumentReady,
  bySlot: ReturnType<typeof buildLivesBySlot>,
  b: ReplayFireBurstReady,
): string | undefined {
  const life = lifeOfSlotAt(bySlot, b.slot, b.t0)
  if (life?.xuid) return life.xuid
  for (const v of doc.vehicles) {
    if (v.slot !== b.v) continue
    const ride = v.rides.find((r) => r.slot === b.slot && r.xuid)
    if (ride?.xuid) return ride.xuid
  }
  return undefined
}
