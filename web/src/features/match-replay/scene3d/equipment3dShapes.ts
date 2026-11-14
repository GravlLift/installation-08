/**
 * equipment3dShapes.ts — LES FORMES 3D DE L'ÉQUIPEMENT : un lot instancié par forme, et une méthode
 * par objet (mur sans cap, faille, capteur, traqueur, champ, objet lâché, poussée). La barrière du mur
 * (`dropWall3d`), la bulle de l'écran occultant (`shroud3d`) et le grappin (`grapple3d`) ont leur propre module.
 *
 * Les PORTÉES sont celles de la 2D, lues dans les fichiers de chaque famille (capteur 4,25 u, champ
 * 3 u, mur de rayon 1,6 u ouvert à 110°) : la 3D n'y ajoute que la hauteur. Les tailles
 * qui ne sont que d'écran en 2D (pixels) reçoivent ici une taille monde, nommée et sans prétention
 * de mesure.
 *
 * Les positions reçues sont en axes three, au sol ; les caps en degrés Halo (0 = +X, 90 = +Y).
 */
import * as THREE from 'three'

import { REPAIR_FIELD_RADIUS_M, seekerImpulse } from '../layers/placementShapes'
import { WALL_RADIUS_M } from '../layers/placementWall'
import { SENSOR_RADIUS_M, sensorPing } from '../model/threatSensor'
import { InstancePool, SegmentPool } from './actionKit'

/** La faille : un anneau debout, à peu près de la taille d'un joueur accroupi. */
const RIFT_RADIUS_U = 0.3
const RIFT_TUBE_RATIO = 0.12
const RIFT_CORE_RATIO = 0.88

/** L'appareil posé (capteur, traqueur, champ) : un palet au sol. */
const DEVICE_RADIUS_U = 0.09
const DEVICE_HEIGHT_U = 0.06
/** L'objet lâché : un octaèdre posé sur sa pointe, à hauteur de ramassage. */
const DROPPED_SIZE_U = 0.1
/** Rayon atteint par l'impulsion du traqueur (la 2D la dit en pixels : 14 px). */
const SEEKER_RING_U = 0.6

/** Les anneaux au sol : des traits fins, à peine décollés du sol. */
const RING_SEGMENTS = 32
const RING_RADIUS_U = 0.015
const RING_LIFT_U = 0.02

/** La flèche de poussée : la hampe, puis une pointe de longueur fixe. */
const ARROW_RADIUS_U = 0.025
const ARROW_HEAD_LENGTH_U = 0.16
const ARROW_HEAD_RADIUS_U = 0.07

/** Opacités des volumes : les zones ne masquent rien. */
const ZONE_OPACITY = 0.18
const RIFT_CORE_OPACITY = 0.45

/** Capacités des lots : au-delà, une instance est ignorée (cf. `InstancePool.add`). */
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
 * headingQuat — la rotation qui tourne l'axe local +Z vers le cap Halo `deg`, autour de la verticale.
 * Le quaternion rendu est partagé : à consommer aussitôt (une pose d'instance).
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

/** Les encres déjà converties d'une faille. */
export interface PairInk3d {
  a: THREE.Color
  b: THREE.Color
}

export class EquipmentShapes3d {
  private readonly tori: InstancePool
  private readonly discs: InstancePool
  private readonly domes: InstancePool
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
    this.pucks = new InstancePool(parent, new THREE.CylinderGeometry(1, 1, 1, 16), solid(), SOLID_CAPACITY)
    this.gems = new InstancePool(parent, new THREE.OctahedronGeometry(1), solid(), SOLID_CAPACITY)
    // La pointe de la flèche : un cône dont la BASE est à l'origine, la pointe vers +Y.
    const cone = new THREE.ConeGeometry(1, 1, 12).translate(0, 0.5, 0)
    this.cones = new InstancePool(parent, cone, solid(), SOLID_CAPACITY)
    this.lines = new SegmentPool(parent, solid(), SEGMENT_CAPACITY)
    this.all = [this.tori, this.discs, this.domes, this.pucks, this.gems, this.cones, this.lines]
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
   * wallRing — le mur dont aucune source ne donne le cap (la 2D trace alors un cercle pointillé) :
   * un anneau au sol du rayon du mur, aucune orientation inventée. Le mur orienté est `dropWall3d`.
   */
  wallRing(at: THREE.Vector3, color: THREE.Color): void {
    this.ring(at, WALL_RADIUS_M, color)
  }

  /** rift — l'anneau debout de la faille (lèvres) et son cœur translucide, tourné vers `headingDeg`. */
  rift(at: THREE.Vector3, headingDeg: number, ink: PairInk3d): void {
    const c = scratch.p.copy(at)
    c.y += RIFT_RADIUS_U * (1 + RIFT_TUBE_RATIO)
    const q = headingQuat(headingDeg)
    this.tori.add(c, q, RIFT_RADIUS_U, ink.a)
    this.discs.add(c, q, RIFT_RADIUS_U * RIFT_CORE_RATIO, ink.b)
  }

  /** sensor — l'appareil, le dôme de sa portée officielle, son anneau et l'onde du ping en cours. */
  sensor(at: THREE.Vector3, ageMs: number, color: THREE.Color): void {
    this.device(at, color)
    this.domes.add(at, null, SENSOR_RADIUS_M, color)
    this.ring(at, SENSOR_RADIUS_M, color)
    const wave = sensorPing(ageMs, false)
    if (wave && wave.reach > 0) this.ring(at, SENSOR_RADIUS_M * wave.reach, color)
  }

  /** seeker — l'appareil et l'anneau de son unique impulsion (le calque ne l'appelle que pendant elle). */
  seeker(at: THREE.Vector3, ageMs: number, color: THREE.Color): void {
    this.device(at, color)
    const wave = seekerImpulse(ageMs, false)
    if (wave && wave.reach > 0) this.ring(at, SEEKER_RING_U * wave.reach, color)
  }

  /** field — l'appareil et le dôme du champ de réparation, à sa portée déclarée. */
  field(at: THREE.Vector3, color: THREE.Color): void {
    this.device(at, color)
    this.domes.add(at, null, REPAIR_FIELD_RADIUS_M, color)
    this.ring(at, REPAIR_FIELD_RADIUS_M, color)
  }

  /** dropped — l'objet tombé au sol, une forme unique pour toutes les familles (règle 2D). */
  dropped(at: THREE.Vector3, color: THREE.Color): void {
    const c = scratch.p.copy(at)
    c.y += DROPPED_SIZE_U
    this.gems.add(c, null, DROPPED_SIZE_U, color)
  }

  /** arrow — une flèche de `length` (u) depuis `from`, le long de `dir` (unitaire, axes three). */
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

  /** ring — un cercle horizontal de traits fins, à peine au-dessus du sol. */
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
