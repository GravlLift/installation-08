// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * vehicles3dModel.ts — VEHICLES READ FOR THE 3D VIEW: position with height, size by family, an
 * occupant's seat on board. No line of three.js here: everything tests without a scene.
 *
 * The drawing rules (decor rejection, display window, heading, occupants, tint) are 2D's own
 * (`model/vehiclesLayer.ts`, `model/vehiclesAim.ts`); this module only adds the third dimension.
 * Halo world units (1 u = 3.048 m, Z up, see `tracks3d`).
 *
 * A SAMPLE'S HEIGHT. A vehicle's published `z` is at the origin height of a biped standing next
 * to it: on boarding, the median gap between the player's last position and their mount's holds
 * within a few hundredths of a unit for every wheeled family. The sample therefore reads as the
 * BOTTOM of the vehicle (its ground contact, within the gap between a biped's origin and feet),
 * not as its center.
 */
import type { ReplayVehicleRide } from '@/lib/api/types'

import { lastIndexAt } from '../../../lib/replay/replayLogic'
import type { ReplayVehicleTrackReady } from '../../../lib/replay/replayNormalize'
import { vehicleActiveRides, vehicleCanEmbark, vehicleVisibleAt } from '../model/vehiclesLayer'

/** A Halo world position. */
export interface VehicleWorld3d {
  x: number
  y: number
  z: number
}

/** A chassis's size: length (heading axis), width, height, in Halo units. */
export interface VehicleSize3d {
  length: number
  width: number
  height: number
}

const box = (length: number, width: number, height: number): VehicleSize3d => ({ length, width, height })

/**
 * VEHICLE_SIZE_3D — the chassis size by DRAWING family (`vehicleSpriteFamily`: the variant when
 * the document names it). The keys are the families the document publishes
 * (`film/replay/vehicle_families.go`) and the variants of schema 69. Game-scale orders of
 * magnitude, not measurements: the box says "a vehicle of this class is here, facing that way."
 */
export const VEHICLE_SIZE_3D: Readonly<Record<string, VehicleSize3d>> = {
  warthog: box(1.8, 0.75, 0.6),
  rockethog: box(1.8, 0.75, 0.6),
  warthog_gauss: box(1.8, 0.75, 0.6),
  razorback: box(2, 0.9, 0.7),
  mongoose: box(0.9, 0.4, 0.35),
  gungoose: box(0.9, 0.4, 0.35),
  ghost: box(1.25, 0.9, 0.4),
  chopper: box(1.6, 0.8, 0.6),
  banshee: box(2, 1.6, 0.5),
  wasp: box(2, 1.6, 0.5),
  falcon: box(3, 2.4, 1),
  scorpion: box(2.6, 1.3, 0.9),
  wraith: box(3, 2, 0.9),
  // Gun emplacements: a base about as wide as it is long.
  shade: box(0.8, 0.8, 0.7),
  tourelle_montee: box(0.8, 0.8, 0.7),
  tourelle_fixe: box(0.8, 0.8, 0.7),
  tourelle_auto_bannie: box(0.6, 0.6, 0.9),
}

/** The size of an unresolved chassis or a family missing from the table. */
export const VEHICLE_SIZE_UNKNOWN: VehicleSize3d = box(1.5, 0.9, 0.6)

export function vehicleSize3d(family: string | undefined): VehicleSize3d {
  return (family && VEHICLE_SIZE_3D[family]) || VEHICLE_SIZE_UNKNOWN
}

/** Minimum height of the chassis bottom above the floor found under it (u). */
export const VEHICLE_FLOOR_LIFT = 0.1
/** Height of an occupant's feet above the chassis bottom (u). */
export const RIDER_ABOVE_BOTTOM = 0.3

type Sample = ReplayVehicleTrackReady['samples'][number]

function worldOf(s: { x: number; y: number; z?: number }): VehicleWorld3d {
  // `z` is omitted when it is zero (`omitempty` serialization).
  return { x: s.x, y: s.y, z: s.z ?? 0 }
}

/**
 * vehicleWorldAt — the vehicle's world position at `frame`, height included, or null.
 *
 * Same reading as the vehicle's 2D position (`vehiclesLayer`): interpolation between samples,
 * held after the last one, position HELD across a replication silence (the sample closing it
 * carries `g > 0`), spawn before the first sample, nothing without either.
 */
export function vehicleWorldAt(track: ReplayVehicleTrackReady, frame: number): VehicleWorld3d | null {
  const samples = track.samples
  if (samples.length === 0 || frame < samples[0].t) return track.spawn ? worldOf(track.spawn) : null
  const i = lastIndexAt(samples, frame)
  const a = samples[i]
  const b: Sample | undefined = samples[i + 1]
  if (!b || frame <= a.t || (b.g ?? 0) > 0 || b.t <= a.t) return worldOf(a)
  const u = (frame - a.t) / (b.t - a.t)
  const wa = worldOf(a)
  const wb = worldOf(b)
  return { x: wa.x + (wb.x - wa.x) * u, y: wa.y + (wb.y - wa.y) * u, z: wa.z + (wb.z - wa.z) * u }
}

/**
 * vehicleBottomY — the three-space height of the chassis bottom. `sampleY` is the sample's
 * three-space height (the vehicle's bottom, see the header), `floorY` the floor found under it
 * (null if none): the chassis never sinks into that floor, and an airborne vehicle keeps its
 * height.
 */
export function vehicleBottomY(sampleY: number, floorY: number | null): number {
  return floorY === null ? sampleY : Math.max(sampleY, floorY + VEHICLE_FLOOR_LIFT)
}

/**
 * seatOffset — an occupant's seat in the vehicle's frame, in Halo units: `forward` on the
 * heading axis, `left` to its left. `order` is their rank in `vehicleActiveRides` (driver
 * first): the first centered slightly back, the next ones in rows of two behind them.
 */
export function seatOffset(order: number, size: VehicleSize3d): { forward: number; left: number } {
  const driverBack = -0.1 * size.length
  if (order <= 0) return { forward: driverBack, left: 0 }
  const row = Math.ceil(order / 2)
  const side = order % 2 === 1 ? 1 : -1
  return {
    forward: Math.max(driverBack - 0.2 * size.length * row, -0.45 * size.length),
    left: side * 0.25 * size.width,
  }
}

/** rotateOffset — an offset in the vehicle's frame brought back to Halo world space (heading in degrees). */
export function rotateOffset(off: { forward: number; left: number }, headingDeg: number): { dx: number; dy: number } {
  const h = (headingDeg * Math.PI) / 180
  const c = Math.cos(h)
  const s = Math.sin(h)
  return { dx: off.forward * c - off.left * s, dy: off.forward * s + off.left * c }
}

/** An occupancy episode named by its xuid, attached to its mount. */
export interface RiderEpisode {
  /** The mount's rank in the list passed to `buildRiderIndex`. */
  vehicle: number
  ride: ReplayVehicleRide
}

/**
 * buildRiderIndex — the episodes BY XUID, on only the lives that can carry a player
 * (`vehicleCanEmbark`: not decor, not an unresolved chassis, not a map element). Same filter as
 * the 2D embarked predicate and a carrier's position.
 */
export function buildRiderIndex(
  tracks: readonly ReplayVehicleTrackReady[],
  kindOf: (family: string) => string | undefined,
): Map<string, RiderEpisode[]> {
  const byXuid = new Map<string, RiderEpisode[]>()
  tracks.forEach((track, vehicle) => {
    if (!vehicleCanEmbark(track, track.family ? kindOf(track.family) : undefined)) return
    for (const ride of track.rides) {
      if (!ride.xuid) continue
      const list = byXuid.get(ride.xuid) ?? []
      list.push({ vehicle, ride })
      byXuid.set(ride.xuid, list)
    }
  })
  return byXuid
}

/** A player's mount at a frame: the life and their rank among the active occupants. */
export interface RiderSeat {
  vehicle: number
  order: number
}

/**
 * riderSeatAt — where `xuid` sits at `frame`: an episode covering the frame, on a vehicle within
 * its display window (`vehicleVisibleAt`), and their rank among the active occupants; null if
 * they are not aboard anything.
 */
export function riderSeatAt(
  episodes: readonly RiderEpisode[] | undefined,
  tracks: readonly ReplayVehicleTrackReady[],
  frame: number,
): RiderSeat | null {
  for (const ep of episodes ?? []) {
    if (frame < ep.ride.t0 || frame > ep.ride.t1) continue
    const track = tracks[ep.vehicle]
    if (!vehicleVisibleAt(track, frame)) continue
    const order = vehicleActiveRides(track, frame).indexOf(ep.ride)
    return { vehicle: ep.vehicle, order: Math.max(order, 0) }
  }
  return null
}
