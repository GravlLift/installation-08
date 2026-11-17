// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * vehiclesAim.ts — THE AIM OF A VEHICLE OCCUPANT (schema 39): which direction, at which
 * image, and when to fall back on the chassis heading.
 *
 * WHY THIS FILE EXISTS (2026-09-03). `vehiclesLayer.ts` crossed the repo's size threshold
 * (CLAUDE.md n°5) by gaining this seventh responsibility, and the rule is to EXTRACT
 * rather than to exempt — exactly the move that had already separated `vehiclesPaint.ts`
 * (the canvas) from `vehiclesLayer.ts` (the rules). The seam falls here on a clean
 * boundary: this file knows ONLY the aim, and it is the only one to read
 * `ReplayVehicleRide.aim`.
 *
 * WHAT SCHEMA 31 CHANGED, AND THAT IS THE POINT OF THE LOT. A vehicle's cone was drawn at
 * the CHASSIS HEADING (`vehicleHeadingAt`), for the driver alone, for lack of a better
 * option: an attached occupant no longer replicates its position, and the repo concluded
 * it no longer replicated anything. Lot V11 showed the fault was in the DECODER, not in
 * the film — the aim of EVERY occupant (driver, gunner, passenger, each on their own
 * biped slot) keeps being transmitted during the whole episode, in records that carry NO
 * position at all. Figures published with the field: accuracy 0.2 to 0.5 deg against
 * the `Point.h` reference (shuffled witness 75.7 to 93.7 deg), coverage 35 attested
 * episodes out of 35, and a gap from the chassis heading of 15.7 to 21.8 deg in median
 * (q3 39.6 to 52.9 deg) — that is the error the old cone made.
 *
 * WHAT DOES NOT COME FROM THERE, refuted WITH WITNESS in the same lot: the orientation of
 * the TURRET as an object. The turret entity replicates nothing at all (flat mask
 * shapes, under the noise floor of a phantom band on one of the two films). The gunner's
 * cone comes from THE MAN.
 */
import type { ReplayVehicleAim, ReplayVehicleRide } from '@/lib/api/types'

import { headingTowardNext } from './headingInterp'
import { lastIndexAt } from '../../../lib/replay/replayLogic'
import type { ReplayVehicleTrackReady } from '../../../lib/replay/replayNormalize'
import {
  vehicleActiveRides,
  vehicleAimAngle,
  vehicleDriverAt,
  vehicleHeadingAt,
  FAMILLES_ARME_FIXE,
} from './vehiclesLayer'

/**
 * VEHICLE_AIM_HOLD_FRAMES — how many frames an aim reading stays IN EFFECT after its
 * instant, before the cone falls back on the chassis heading.
 *
 * TEN FRAMES, THAT IS ONE SECOND, AND THE FIGURE COMES FROM THE MEASUREMENT: the film
 * replicates an occupant's aim at 5 to 46 readings per second (lot V11, 35 attested
 * episodes, 5 films) for 10 frames published per second — a whole second without any
 * reading is therefore not a sampling defect, it is a real interruption of the stream.
 *
 * THIS IS NOT `TIMING_MS.aimHold` (5 s, the gaze hold of a PIECE), and they must not be
 * confused: the piece holds its aim a long time because its `h` is transmitted on only
 * ~44% of its points, while an occupant's series is DENSE by construction. Holding 5 s
 * here would display an expired direction where the chassis, for its part, is known to
 * the image.
 */
export const VEHICLE_AIM_HOLD_FRAMES = 10

/**
 * VehicleOccupantAim — WHAT AN OCCUPANT LOOKS AT on an image, ready to paint.
 *
 * `measured` IS NOT decorative: it is the difference between an aim READ IN THE FILM
 * (0.2 to 0.5 deg off the published reference) and the FALLBACK on the chassis heading,
 * which is off by 15.7 to 21.8 deg in median and by more than 40 deg at the upper
 * quartile. The tests hook onto it, and a future rendering can read it (opacity, style)
 * without having to rediscover the rule.
 */
export interface VehicleOccupantAim {
  /** CANVAS angle of the cone, in radians (the world -> screen inversion is already applied). */
  ang: number
  /** Elevation in degrees, positive = upward. 0 = level, including in fallback. */
  pitchDeg: number
  /** true = MEASURED aim of this occupant; false = fallback on the chassis heading. */
  measured: boolean
}

/**
 * vehicleRideAimReading — the last aim reading IN EFFECT at `frame` for this episode, or
 * `null` (no series, no reading as of at least this image, or reading too old).
 *
 * BETWEEN TWO CONSECUTIVE READINGS (gap of at most the hold), the heading TURNS from one
 * to the other by the shortest angular path (`headingTowardNext`, v8 controls of
 * 2026-10-21): held at the last reading, it made the chassis and the cone rotate in
 * 100 ms jerks. The elevation (`p`) stays, for its part, that of the last reading. Past
 * the hold, no reading is invented: it returns `null`.
 *
 * A POINT WITHOUT `h` IS SKIPPED. The server contract publishes 360 rather than 0 (the
 * omitempty TRAP, cf. `headingForJSON` on the Go side), so the case should not exist —
 * but the field is optional in the contract, and a cone left at 0 by default would point
 * east without anything having measured it.
 */
export function vehicleRideAimReading(
  ride: ReplayVehicleRide,
  frame: number,
): ReplayVehicleAim | null {
  const aim = ride.aim
  if (!aim || aim.length === 0) return null
  for (let i = lastIndexAt(aim, frame); i >= 0; i--) {
    const a = aim[i]
    if (frame - a.t > VEHICLE_AIM_HOLD_FRAMES) return null
    if (a.h !== undefined) return { ...a, h: headingTowardNext(aim, i, frame, VEHICLE_AIM_HOLD_FRAMES) }
  }
  return null
}

/**
 * vehicleShooterAimAt — THE AIM OF THE SHOOTER OF A VEHICLE SHOT, in world degrees, or
 * `null`.
 *
 * ## Why this is NOT a matter of seat (lot 5.5, 2026-09-21)
 *
 * A TURRET shot (Warthog, Scorpion) left with no direction at all: the film does not
 * publish the turret's orientation, and lot 5.5.1 established it by TWO measured
 * negatives — the `ti=40 i41`/`i42` components (`vehicle-seats-override-pitch`/`-yaw`)
 * are a SCRIPT API (a pair of angles in degrees set by the mission engine, not a
 * per-tick value) and NO record declares them: 0 out of 253,863 vehicle records, two
 * films, while the same census finds components present on ONE SINGLE record. Same
 * negative for the AUTOMATIC turret aim (`i31`) and for the `i21` of the vehicle itself.
 *
 * THE ONLY MEASURED DIRECTION LEFT IS THE SHOOTER'S, and the document already publishes
 * it: the aim of EVERY occupant travels during the whole episode (schema 31, accuracy
 * 0.2-0.5 degrees).
 *
 * ## THE PAIRING IS DONE BY SLOT, AND THAT IS WHAT MAKES THE RULE RIGHT
 *
 * A shot carries the slot of its SHOOTER (`Shot.slot`, the one that already feeds
 * `heldReading`) and an occupation episode carries the slot of its OCCUPANT
 * (`ReplayVehicleRide.slot`). Pairing them returns the episode of THE ONE WHO FIRED —
 * hence its aim — without ever assuming which seat serves which weapon. This is
 * essential: the Warthog's turret gunner is a passenger, while the Scorpion's cannon is
 * served by the DRIVER; and the measurement showed the `seat` field does not
 * discriminate (on the 100 turret shots of `4f77afc1`, the shooter's episode declares
 * `seat = 0` 84 times and stays silent 16 — the SEAT is not reliable, the SLOT is).
 *
 * MEASUREMENT (baked documents, no decoding): on the 100 turret shots of `4f77afc1`,
 * the shooter's episode is found **100 times out of 100** and carries an aim IN EFFECT
 * **95 times**. Its gap from the heading at which the chassis is drawn is **43.5
 * degrees in median** (q75 105.1; q90 146.7): this is not a refinement, it is the
 * direction the rendering ignored.
 */
export function vehicleShooterAimAt(
  track: ReplayVehicleTrackReady,
  shooterSlot: number,
  frame: number,
): number | null {
  // `vehicleActiveRides` RATHER THAN A HAND-WRITTEN FILTER: the predicate "does this
  // episode cover this image" lives there and nowhere else (CLAUDE.md n°6) — recopying it
  // here would make a third spelling of the same bound.
  const shooterRide = vehicleActiveRides(track, frame).find((r) => r.slot === shooterSlot)
  if (!shooterRide) return null
  return vehicleRideAimReading(shooterRide, frame)?.h ?? null
}

/**
 * vehicleOccupantAimAt — THE DIRECTION OF AN OCCUPANT'S CONE: its measurement first, the
 * chassis as fallback.
 *
 * THE FALLBACK STAYS THE CHASSIS HEADING when the episode has no aim in effect on this
 * image — that is EXACTLY the behavior before the aim series, so that an earlier
 * artifact (no `aim` anywhere) renders the same cone as before, without a special branch
 * or a version test.
 */
export function vehicleOccupantAimAt(
  track: ReplayVehicleTrackReady,
  ride: ReplayVehicleRide,
  frame: number,
): VehicleOccupantAim {
  const read = vehicleRideAimReading(ride, frame)
  if (read && read.h !== undefined) {
    return { ang: vehicleAimAngle(read.h), pitchDeg: read.p ?? 0, measured: true }
  }
  // LEVEL IN FALLBACK, and that is a measurement: the chassis heading is the direction of
  // a MOVEMENT, which is horizontal — lending it an elevation would invent a second angle.
  return { ang: vehicleAimAngle(vehicleHeadingAt(track, frame)), pitchDeg: 0, measured: false }
}
/**
 * vehicleChassisHeadingAt — THE HEADING AT WHICH THE CHASSIS IS DRAWN: the DRIVER's aim on
 * fixed-weapon families, velocity everywhere else.
 *
 * ## Why this function exists (2026-09-20)
 *
 * THE CHASSIS WAS DRAWN AT THE DIRECTION OF ITS VELOCITY (`vehicleHeadingAt`) — that is
 * "where the vehicle is moving", not "where it points". A vehicle reversing, skidding,
 * turning, flying or stopped has its nose nowhere in that direction, and 16 to 31% of
 * the trajectory points carry none of it (below the producer's speed threshold).
 *
 * THE FILM'S PROPER ORIENTATION HAS BEEN REFUTED, it will not come fill this hole: lot
 * 5.2-B measured the candidate component of `ti=40` (`i2`) and it is a UP vector, not a
 * forward one — medians of 54 to 105 degrees against the velocity.
 *
 * THE USER'S DECISION (2026-09-20) is therefore to take the only direction the vehicle
 * carries of its own AND that is measured: « le châssis s'oriente là où l'ARME pointe »
 * [the chassis orients where the WEAPON points]. On a fixed-weapon family, aiming IS
 * turning the vehicle — the driver's aim is therefore the front of the chassis, to within
 * 0.2-0.5 degrees (schema 31). On a turret family it is not, and the pilot is not even
 * the shooter: the fallback stays the velocity.
 *
 * ## The four regimes, in order
 *
 *   1. DRIVER'S AIM — fixed-weapon family (`FAMILLES_ARME_FIXE`), a SEAT 0 episode in
 *      effect on this image, and an aim reading in effect on it.
 *   2. VELOCITY — everything else, exactly as before: turret family, empty seat 0
 *      (abandoned vehicle, or driven by no one), or episode without an aim reading in
 *      effect.
 *   3. NEIGHBOR HEADING — no backward sample carries a heading (vehicle still berthed).
 *   4. DEFAULT — `VEHICLE_DEFAULT_HEADING_DEG`, nose upward.
 *
 * Regimes 2 to 4 are `vehicleHeadingAt` as is: this function only ADDS the first one
 * in front.
 *
 * ## Why here and not in `vehiclesLayer`
 *
 * This module is the ONLY one to read `ReplayVehicleRide.aim` (cf. the header), and
 * `vehiclesLayer` does not import it — putting it there would create a cycle between
 * the two files. The TABLE of families, for its part, stays with the other family
 * tables (`FAMILLES_ARME_FIXE`).
 *
 * ## What this function does NOT change
 *
 * The CONE FALLBACK of the aim (`vehicleOccupantAimAt`) keeps `vehicleHeadingAt`, the
 * bare velocity: that fallback is marked `measured: false`, and giving it the aim of
 * ANOTHER occupant would pass off someone else's measurement as one's own approximation.
 */
export function vehicleChassisHeadingAt(
  track: ReplayVehicleTrackReady,
  frame: number,
): number {
  if (track.family !== undefined && FAMILLES_ARME_FIXE.has(track.family)) {
    const driver = vehicleDriverAt(track, frame)
    const read = driver ? vehicleRideAimReading(driver, frame) : null
    if (read?.h !== undefined) return read.h
  }
  return vehicleHeadingAt(track, frame)
}
