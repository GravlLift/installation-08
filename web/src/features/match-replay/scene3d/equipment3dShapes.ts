// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * equipment3dShapes.ts — EQUIPMENT'S 3D SHAPES: one instanced pool per shape, and one method per
 * object (headingless wall, rift, sensor, tracker, field, dropped object, push). The wall's own
 * barrier (`dropWall3d`), the shroud screen's bubble (`shroud3d`) and the grapple (`grapple3d`)
 * have their own module.
 *
 * RANGES are the 2D's own, read from each family's files, CONVERTED TO THE SCENE'S UNIT (1 u =
 * 3.048 m) per what each constant says: the sensor is published in the game's own units
 * ("Sensor Radius: 4.25wu", `threatSensor.ts`) and is worth 4.25 u; the repair field (3 m) and
 * the wall (radius 1.6 m, chord 2.6 m) are screen choices calibrated IN METERS against the
 * game's object, and so are worth 3 / 3.048 u and 1.6 / 3.048 u (`metersToU`). Sizes that are
 * only ever a screen size in 2D (pixels) get a world size here instead, named and with no claim
 * to being a measurement.
 *
 * THE THREAT SENSOR'S FIELD (user return of 2026-11-14, from the game): a FULL sphere around the
 * device, of the game's radius, very lightly tinted in the planter's team color, with the ping
 * as a brief brighter shell opening out to the radius. Not the half dome at the 0.18 opacity of
 * the zones, which read as a giant saturated bubble.
 *
 * Received positions are in three axes, on the ground (except the sensor: its published
 * position, it sticks to walls); headings in Halo degrees (0 = +X, 90 = +Y).
 */
import * as THREE from 'three'

import { REPAIR_FIELD_RADIUS_M, seekerImpulse } from '../layers/placementShapes'
import { SENSOR_RADIUS_M, sensorPing } from '../model/threatSensor'
import { InstancePool, SegmentPool } from './actionKit'
import { WALL_RADIUS_U } from './dropWall3d_logic'
import { metersToU } from './tracks3d'

/** Radius of the repair field's dome (u): the 2D's declared 3 m. */
export const REPAIR_FIELD_RADIUS_U = metersToU(REPAIR_FIELD_RADIUS_M)

/**
 * Radius of the threat sensor's sphere (u). OFFICIAL, in the game's own unit ("Sensor Radius:
 * 4.25wu", Halo Waypoint sandbox notes quoted in `threatSensor.ts`): the scene is in world
 * units, so no conversion. The film and the Ekur export carry no equipment tag to check it
 * against.
 */
export const SENSOR_SPHERE_RADIUS_U = SENSOR_RADIUS_M

/**
 * Opacity of each face of the sensor's sphere: very light, as the game's field (user return of
 * 2026-11-14: "a very lightly colored sphere in the team color"). Seen from outside, the two faces
 * add to about the 2D zone fill (`SENSOR_FILL_ALPHA` 0.1); from inside, one face tints the view.
 */
export const SENSOR_FIELD_OPACITY = 0.05
/** Peak opacity of the ping's shell, which fades as it opens (`sensorPing`'s alpha, 0.9 at the start). */
export const SENSOR_PING_OPACITY = 0.2

/** The rift: a standing ring, roughly the size of a crouched player. */
const RIFT_RADIUS_U = 0.3
const RIFT_TUBE_RATIO = 0.12
const RIFT_CORE_RATIO = 0.88

/** A placed device (sensor, tracker, field): a puck on the ground. */
const DEVICE_RADIUS_U = 0.09
const DEVICE_HEIGHT_U = 0.06
/** The dropped object: an octahedron standing on its tip, at pickup height. */
const DROPPED_SIZE_U = 0.1
/** Radius reached by the tracker's impulse (the 2D states it in pixels: 14 px). */
const SEEKER_RING_U = 0.6

/** Ground rings: thin lines, barely lifted off the ground. */
const RING_SEGMENTS = 32
const RING_RADIUS_U = 0.015
const RING_LIFT_U = 0.02

/** The push arrow: the shaft, then a fixed-length head. */
const ARROW_RADIUS_U = 0.025
const ARROW_HEAD_LENGTH_U = 0.16
const ARROW_HEAD_RADIUS_U = 0.07

/** Volume opacities: the zones occlude nothing. */
const ZONE_OPACITY = 0.18
const RIFT_CORE_OPACITY = 0.45

/** Pool capacities: beyond them, an instance is ignored (see `InstancePool.add`). */
const SOLID_CAPACITY = 256
const VOLUME_CAPACITY = 64
const SEGMENT_CAPACITY = 4096

const UP = new THREE.Vector3(0, 1, 0)
const scratch = {
  q: new THREE.Quaternion(),
  p: new THREE.Vector3(),
  a: new THREE.Vector3(),
  b: new THREE.Vector3(),
  s: new THREE.Vector3(),
}

/**
 * headingQuat — the rotation that turns the local +Z axis to Halo heading `deg`, around the
 * vertical. The returned quaternion is shared: consume it right away (one instance pose).
 */
export function headingQuat(deg: number): THREE.Quaternion {
  return scratch.q.setFromAxisAngle(UP, (deg * Math.PI) / 180 + Math.PI / 2)
}

function solid(): THREE.Material {
  return new THREE.MeshLambertMaterial()
}

function volume(opacity: number, side: THREE.Side = THREE.FrontSide): THREE.Material {
  return new THREE.MeshBasicMaterial({ transparent: true, opacity, depthWrite: false, side })
}

/**
 * FadingPool — a pool of translucent shapes whose OPACITY is per instance (an `instanceAlpha`
 * attribute multiplied into the basic material's alpha): the sensor's field and its fading ping
 * share one draw.
 */
export class FadingPool {
  private readonly pool: InstancePool
  private readonly alpha: THREE.InstancedBufferAttribute
  private readonly capacity: number
  private n = 0

  constructor(parent: THREE.Object3D, geometry: THREE.BufferGeometry, capacity: number) {
    this.capacity = capacity
    this.alpha = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
    geometry.setAttribute('instanceAlpha', this.alpha)
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float instanceAlpha;\nvarying float vInstanceAlpha;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInstanceAlpha = instanceAlpha;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vInstanceAlpha;')
        .replace('#include <opaque_fragment>', 'diffuseColor.a *= vInstanceAlpha;\n#include <opaque_fragment>')
    }
    this.pool = new InstancePool(parent, geometry, material, capacity)
  }

  get mesh(): THREE.InstancedMesh {
    return this.pool.mesh
  }

  /** The opacity of the instance `i` posed since `begin`. */
  alphaAt(i: number): number {
    return this.alpha.getX(i)
  }

  begin(): void {
    this.n = 0
    this.pool.begin()
  }

  add(pos: THREE.Vector3, scale: number, color: THREE.Color, alpha: number): void {
    if (this.n >= this.capacity || !(alpha > 0)) return
    this.alpha.setX(this.n++, alpha)
    this.pool.add(pos, null, scale, color)
  }

  end(): void {
    this.pool.end()
    this.alpha.needsUpdate = true
  }

  dispose(): void {
    this.pool.dispose()
  }
}

/** A rift's already-converted inks. */
export interface PairInk3d {
  a: THREE.Color
  b: THREE.Color
}

export class EquipmentShapes3d {
  private readonly tori: InstancePool
  private readonly discs: InstancePool
  private readonly domes: InstancePool
  /** The sensor's full spheres: its field and its ping, each at its own opacity. */
  readonly spheres: FadingPool
  private readonly pucks: InstancePool
  private readonly gems: InstancePool
  private readonly cones: InstancePool
  private readonly lines: SegmentPool
  private readonly all: { begin(): void; end(): void; dispose(): void }[]

  constructor(parent: THREE.Object3D) {
    this.tori = new InstancePool(parent, new THREE.TorusGeometry(1, RIFT_TUBE_RATIO, 8, 32), solid(), VOLUME_CAPACITY)
    this.discs = new InstancePool(parent, new THREE.CircleGeometry(1, 32), volume(RIFT_CORE_OPACITY, THREE.DoubleSide), VOLUME_CAPACITY)
    const hemisphere = new THREE.SphereGeometry(1, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2)
    this.domes = new InstancePool(parent, hemisphere, volume(ZONE_OPACITY, THREE.DoubleSide), VOLUME_CAPACITY)
    this.spheres = new FadingPool(parent, new THREE.SphereGeometry(1, 48, 24), VOLUME_CAPACITY)
    this.pucks = new InstancePool(parent, new THREE.CylinderGeometry(1, 1, 1, 16), solid(), SOLID_CAPACITY)
    this.gems = new InstancePool(parent, new THREE.OctahedronGeometry(1), solid(), SOLID_CAPACITY)
    // The arrow's head: a cone whose BASE is at the origin, tip toward +Y.
    const cone = new THREE.ConeGeometry(1, 1, 12).translate(0, 0.5, 0)
    this.cones = new InstancePool(parent, cone, solid(), SOLID_CAPACITY)
    this.lines = new SegmentPool(parent, solid(), SEGMENT_CAPACITY)
    this.all = [this.tori, this.discs, this.domes, this.spheres, this.pucks, this.gems, this.cones, this.lines]
  }

  begin(): void {
    for (const p of this.all) p.begin()
  }

  end(): void {
    for (const p of this.all) p.end()
  }

  dispose(): void {
    for (const p of this.all) p.dispose()
  }

  /**
   * wallRing — the wall with no source giving its heading (the 2D then draws a dotted circle):
   * a ground ring of the wall's radius, no invented orientation. The oriented wall is `dropWall3d`.
   */
  wallRing(at: THREE.Vector3, color: THREE.Color): void {
    this.ring(at, WALL_RADIUS_U, color)
  }

  /** rift — the rift's standing ring (lip) and its translucent core, turned toward `headingDeg`. */
  rift(at: THREE.Vector3, headingDeg: number, ink: PairInk3d): void {
    const c = scratch.p.copy(at)
    c.y += RIFT_RADIUS_U * (1 + RIFT_TUBE_RATIO)
    const q = headingQuat(headingDeg)
    this.tori.add(c, q, RIFT_RADIUS_U, ink.a)
    this.discs.add(c, q, RIFT_RADIUS_U * RIFT_CORE_RATIO, ink.b)
  }

  /**
   * sensor — the device at `center` (its published position: it sticks where it lands), the full
   * sphere of its official range very lightly tinted in `color`, and the shell of the ping in
   * progress opening out to the radius while it fades (`sensorPing`, every 1.8 s).
   */
  sensor(center: THREE.Vector3, ageMs: number, color: THREE.Color): void {
    const c = scratch.p.copy(center)
    c.y -= DEVICE_HEIGHT_U / 2
    this.device(c, color)
    this.spheres.add(center, SENSOR_SPHERE_RADIUS_U, color, SENSOR_FIELD_OPACITY)
    const wave = sensorPing(ageMs, false)
    if (wave && wave.reach > 0) this.spheres.add(center, SENSOR_SPHERE_RADIUS_U * wave.reach, color, SENSOR_PING_OPACITY * wave.alpha)
  }

  /** seeker — the device and the ring of its single impulse (the layer only calls this during it). */
  seeker(at: THREE.Vector3, ageMs: number, color: THREE.Color): void {
    this.device(at, color)
    const wave = seekerImpulse(ageMs, false)
    if (wave && wave.reach > 0) this.ring(at, SEEKER_RING_U * wave.reach, color)
  }

  /**
   * field — the device and the repair field's dome, at its declared range (3 m). A dome on
   * the ground, as the 2D's own source says of the game's ("what the dome of the game shelters",
   * `placementShapes.REPAIR_FIELD_RADIUS_M`).
   */
  field(at: THREE.Vector3, color: THREE.Color): void {
    this.device(at, color)
    this.domes.add(at, null, REPAIR_FIELD_RADIUS_U, color)
    this.ring(at, REPAIR_FIELD_RADIUS_U, color)
  }

  /** dropped — the object fallen to the ground, one shape for every family (the 2D's own rule). */
  dropped(at: THREE.Vector3, color: THREE.Color): void {
    const c = scratch.p.copy(at)
    c.y += DROPPED_SIZE_U
    this.gems.add(c, null, DROPPED_SIZE_U, color)
  }

  /** arrow — an arrow of `length` (u) from `from`, along `dir` (unit, three axes). */
  arrow(from: THREE.Vector3, dir: THREE.Vector3, length: number, color: THREE.Color): void {
    const head = Math.min(ARROW_HEAD_LENGTH_U, length)
    const base = scratch.b.copy(dir).multiplyScalar(length - head).add(from)
    this.lines.add(from, base, ARROW_RADIUS_U, color)
    const q = scratch.q.setFromUnitVectors(UP, dir)
    this.cones.add(base, q, scratch.s.set(ARROW_HEAD_RADIUS_U, head, ARROW_HEAD_RADIUS_U), color)
  }

  private device(at: THREE.Vector3, color: THREE.Color): void {
    const c = scratch.p.copy(at)
    c.y += DEVICE_HEIGHT_U / 2
    this.pucks.add(c, null, scratch.s.set(DEVICE_RADIUS_U, DEVICE_HEIGHT_U, DEVICE_RADIUS_U), color)
  }

  /** ring — a horizontal circle of thin lines, barely above the ground. */
  private ring(at: THREE.Vector3, radius: number, color: THREE.Color): void {
    if (!(radius > 0)) return
    for (let i = 0; i < RING_SEGMENTS; i++) {
      const u = (i / RING_SEGMENTS) * Math.PI * 2
      const v = ((i + 1) / RING_SEGMENTS) * Math.PI * 2
      scratch.a.set(at.x + radius * Math.cos(u), at.y + RING_LIFT_U, at.z + radius * Math.sin(u))
      scratch.b.set(at.x + radius * Math.cos(v), at.y + RING_LIFT_U, at.z + radius * Math.sin(v))
      this.lines.add(scratch.a, scratch.b, RING_RADIUS_U, color)
    }
  }
}
