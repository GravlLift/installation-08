// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * vehicles3d.ts — VEHICLES IN THE 3D SCENE: a box per vehicle, a cone on its nose.
 *
 * What draws is what the 2D draws (`layers/vehiclesPaint.ts`): neither decor, nor map decor, nor
 * a mounted turret (`vehicleIsHidden`); a map element draws with the "no team" ink; a vehicle
 * takes its driver's color, failing that an occupant's, failing that the neutral ink
 * (`vehiclePaintColor`); the display window is `vehicleVisibleAt` and the heading is the
 * sprite's own (`vehicleChassisHeadingAt`). The 3D adds the height and the size
 * (`vehicles3dModel`).
 *
 * The layer also answers to the scene: a player aboard no longer replicates their own position,
 * they stand on their mount (`riderAt`). This response does not follow the layer's toggle:
 * vehicles hidden, an occupant stays aboard rather than sliding in a straight line through walls.
 */
import * as THREE from 'three'

import type { ReplayVehicleTrackReady } from '../../../lib/replay/replayNormalize'
import { vehicleChassisHeadingAt } from '../model/vehiclesAim'
import { vehicleIsHidden, vehiclePaintColor, vehicleSpriteFamily, vehicleVisibleAt } from '../model/vehiclesLayer'
import type { Action3dInputs } from './action3dInputs'
import { InstancePool } from './actionKit'
import type { ActionContext, ActionLayer3d } from './actionScene3d'
import { toThree } from './tracks3d'
import {
  RIDER_ABOVE_BOTTOM,
  buildRiderIndex,
  riderSeatAt,
  rotateOffset,
  seatOffset,
  vehicleBottomY,
  vehicleSize3d,
  vehicleWorldAt,
  type RiderEpisode,
  type RiderSeat,
  type VehicleSize3d,
} from './vehicles3dModel'

const CAPACITY = 128
// The nose cone: its length and radius (u), capped by the box's width.
const NOSE_LENGTH = 0.35
const NOSE_RADIUS = 0.18
const NOSE_RADIUS_OF_WIDTH = 0.3

const UP = new THREE.Vector3(0, 1, 0)

/** A drawable life, prepared once: its rank in the document and its published kind. */
interface VehicleEntry {
  index: number
  kind: string | undefined
}

/** A vehicle's pose at a frame, in three.js axes. */
interface VehiclePose {
  x: number
  z: number
  /** The bottom of the box. */
  bottom: number
  /** Halo world heading, degrees. */
  heading: number
  size: VehicleSize3d
}

export class Vehicles3dLayer implements ActionLayer3d {
  private readonly bodies: InstancePool
  private readonly noses: InstancePool
  private readonly tracks: readonly ReplayVehicleTrackReady[]
  private readonly entries: VehicleEntry[]
  private readonly sizes: VehicleSize3d[]
  private readonly riders: Map<string, RiderEpisode[]>
  private poseFrame = Number.NaN
  private readonly poses = new Map<number, VehiclePose | null>()
  private seatFrame = Number.NaN
  private readonly seats = new Map<string, RiderSeat | null>()
  private readonly q = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly s = new THREE.Vector3()

  private readonly ctx: ActionContext

  constructor(ctx: ActionContext) {
    this.ctx = ctx
    this.tracks = ctx.doc.vehicles
    const labels = ctx.doc.vehicleLabels
    const kindOf = (family: string) => labels?.[family]?.kind
    this.sizes = this.tracks.map((t) => vehicleSize3d(vehicleSpriteFamily(t)))
    this.entries = this.tracks.flatMap((t, index) =>
      vehicleIsHidden(t) ? [] : [{ index, kind: t.family ? kindOf(t.family) : undefined }],
    )
    this.riders = buildRiderIndex(this.tracks, kindOf)
    this.bodies = new InstancePool(ctx.root, new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), CAPACITY)
    this.bodies.mesh.castShadow = true
    // The cone points toward local +X: the box's heading axis.
    const nose = new THREE.ConeGeometry(1, 1, 12).rotateZ(-Math.PI / 2)
    this.noses = new InstancePool(ctx.root, nose, new THREE.MeshBasicMaterial({ toneMapped: false }), CAPACITY)
  }

  update(frame: number): void {
    const inputs = this.ctx.inputs()
    this.bodies.begin()
    this.noses.begin()
    if (inputs.show.vehicles) {
      for (const entry of this.entries) {
        const track = this.tracks[entry.index]
        if (!vehicleVisibleAt(track, frame)) continue
        const pose = this.poseAt(entry.index, frame)
        if (pose) this.draw(pose, this.colorOf(track, entry, frame, inputs))
      }
    }
    this.bodies.end()
    this.noses.end()
  }

  riderAt(xuid: string, frame: number): THREE.Vector3 | null {
    const seat = this.seatOf(xuid, frame)
    if (!seat) return null
    const pose = this.poseAt(seat.vehicle, frame)
    if (!pose) return null
    const { dx, dy } = rotateOffset(seatOffset(seat.order, pose.size), pose.heading)
    // Halo (dx, dy) -> three.js (dx, -dy): the same conversion as `toThree`.
    return new THREE.Vector3(pose.x + dx, pose.bottom + RIDER_ABOVE_BOTTOM, pose.z - dy)
  }

  /** riderHeadingAt: the vehicle's heading for a player aboard (degrees, `Point.h` convention). */
  riderHeadingAt(xuid: string, frame: number): number | null {
    const seat = this.seatOf(xuid, frame)
    return seat ? (this.poseAt(seat.vehicle, frame)?.heading ?? null) : null
  }

  dispose(): void {
    this.bodies.dispose()
    this.noses.dispose()
  }

  private colorOf(track: ReplayVehicleTrackReady, entry: VehicleEntry, frame: number, inputs: Action3dInputs): THREE.Color {
    const css = vehiclePaintColor(track, frame, entry.kind, inputs, {
      neutral: inputs.inks.neutral,
      mapElement: inputs.inks.zone.fill,
    })
    return this.ctx.ink.of(css)
  }

  private draw(pose: VehiclePose, color: THREE.Color): void {
    const { length, width, height } = pose.size
    const h = (pose.heading * Math.PI) / 180
    this.q.setFromAxisAngle(UP, h)
    const midY = pose.bottom + height / 2
    this.bodies.add(this.p.set(pose.x, midY, pose.z), this.q, this.s.set(length, height, width), color)
    const reach = length / 2 + NOSE_LENGTH / 2
    const r = Math.min(NOSE_RADIUS, width * NOSE_RADIUS_OF_WIDTH)
    this.p.set(pose.x + Math.cos(h) * reach, midY, pose.z - Math.sin(h) * reach)
    this.noses.add(this.p, this.q, this.s.set(NOSE_LENGTH, r, r), color)
  }

  /** seatOf: a player's mount, re-read once per whole frame. */
  private seatOf(xuid: string, frame: number): RiderSeat | null {
    const whole = Math.floor(frame)
    if (whole !== this.seatFrame) {
      this.seatFrame = whole
      this.seats.clear()
    }
    let seat = this.seats.get(xuid)
    if (seat === undefined) {
      seat = riderSeatAt(this.riders.get(xuid), this.tracks, whole)
      this.seats.set(xuid, seat)
    }
    return seat
  }

  /** poseAt: a life's pose at the exact frame, shared between drawing and its occupants. */
  private poseAt(index: number, frame: number): VehiclePose | null {
    if (frame !== this.poseFrame) {
      this.poseFrame = frame
      this.poses.clear()
    }
    let pose = this.poses.get(index)
    if (pose === undefined) {
      pose = this.computePose(index, frame)
      this.poses.set(index, pose)
    }
    return pose
  }

  private computePose(index: number, frame: number): VehiclePose | null {
    const track = this.tracks[index]
    const world = vehicleWorldAt(track, frame)
    if (!world) return null
    const [x, y, z] = toThree(world.x, world.y, world.z)
    // The sample is at the height of a biped's origin standing by the vehicle: its feet are
    // `originAboveFloor` lower, and that is where the box touches the ground.
    const floor = this.ctx.ground.floorY(world.x, world.y, world.z)
    return {
      x,
      z,
      bottom: vehicleBottomY(y - this.ctx.originAboveFloor, floor),
      heading: vehicleChassisHeadingAt(track, frame),
      size: this.sizes[index],
    }
  }
}
