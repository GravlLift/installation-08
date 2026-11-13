/**
 * vehicles3dModel.ts — LES VÉHICULES LUS POUR LA VUE 3D : position avec la hauteur, gabarit par
 * famille, place d'un occupant à bord. Aucune ligne de three.js ici : tout se teste sans scène.
 *
 * Les règles de dessin (refus du décor, fenêtre d'affichage, cap, occupants, teinte) sont celles
 * de la 2D (`model/vehiclesLayer.ts`, `model/vehiclesAim.ts`) ; ce module n'y ajoute que la
 * troisième dimension. Unités monde Halo (1 u = 3,048 m, Z vers le haut, cf. `tracks3d`).
 *
 * HAUTEUR D'UN ÉCHANTILLON. Le `z` publié d'un véhicule est à la hauteur de l'origine d'un bipède
 * debout à côté de lui : à la montée à bord, l'écart médian entre la dernière position du joueur
 * et celle de sa monture tient dans quelques centièmes d'unité pour toutes les familles roulantes.
 * L'échantillon se lit donc comme le BAS du véhicule (son contact au sol, à l'écart près entre
 * l'origine et les pieds d'un bipède), pas comme son centre.
 */
import type { ReplayVehicleRide } from '@/lib/api/types'

import { lastIndexAt } from '../../../lib/replay/replayLogic'
import type { ReplayVehicleTrackReady } from '../../../lib/replay/replayNormalize'
import { vehicleActiveRides, vehicleCanEmbark, vehicleVisibleAt } from '../model/vehiclesLayer'

/** Une position monde Halo. */
export interface VehicleWorld3d {
  x: number
  y: number
  z: number
}

/** Le gabarit d'une caisse : longueur (axe du cap), largeur, hauteur, en unités Halo. */
export interface VehicleSize3d {
  length: number
  width: number
  height: number
}

const box = (length: number, width: number, height: number): VehicleSize3d => ({ length, width, height })

/**
 * VEHICLE_SIZE_3D — le gabarit de la caisse par famille de DESSIN (`vehicleSpriteFamily` : la
 * variante quand le document la nomme). Les clés sont les familles publiées par le document
 * (`film/replay/vehicle_families.go`) et les variantes du schéma 69. Ordres de grandeur du jeu,
 * pas des mesures : la caisse dit « un véhicule de cette classe est là, tourné par là ».
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
  // Les postes de tir : une embase à peu près aussi large que longue.
  shade: box(0.8, 0.8, 0.7),
  tourelle_montee: box(0.8, 0.8, 0.7),
  tourelle_fixe: box(0.8, 0.8, 0.7),
  tourelle_auto_bannie: box(0.6, 0.6, 0.9),
}

/** Le gabarit d'un châssis non résolu ou d'une famille absente de la table. */
export const VEHICLE_SIZE_UNKNOWN: VehicleSize3d = box(1.5, 0.9, 0.6)

export function vehicleSize3d(family: string | undefined): VehicleSize3d {
  return (family && VEHICLE_SIZE_3D[family]) || VEHICLE_SIZE_UNKNOWN
}

/** Hauteur minimale du bas de la caisse au-dessus du sol trouvé sous elle (u). */
export const VEHICLE_FLOOR_LIFT = 0.1
/** Hauteur des pieds d'un occupant au-dessus du bas de la caisse (u). */
export const RIDER_ABOVE_BOTTOM = 0.3

type Sample = ReplayVehicleTrackReady['samples'][number]

function worldOf(s: { x: number; y: number; z?: number }): VehicleWorld3d {
  // Le `z` est omis quand il vaut zéro (sérialisation `omitempty`).
  return { x: s.x, y: s.y, z: s.z ?? 0 }
}

/**
 * vehicleWorldAt — la position monde du véhicule à `frame`, hauteur comprise, ou null.
 *
 * Même lecture que la position 2D du véhicule (`vehiclesLayer`) : interpolation entre échantillons, maintien après le
 * dernier, position TENUE au travers d'un silence de réplication (l'échantillon qui le clôt porte
 * `g > 0`), naissance avant le premier échantillon, rien sans l'une ni l'autre.
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
 * vehicleBottomY — la hauteur three du bas de la caisse. `sampleY` est la hauteur three de
 * l'échantillon (le bas du véhicule, cf. l'en-tête), `floorY` le sol trouvé sous lui (null si
 * aucun) : la caisse ne s'enfonce jamais dans ce sol, et un véhicule en vol garde sa hauteur.
 */
export function vehicleBottomY(sampleY: number, floorY: number | null): number {
  return floorY === null ? sampleY : Math.max(sampleY, floorY + VEHICLE_FLOOR_LIFT)
}

/**
 * seatOffset — la place d'un occupant dans le repère du véhicule, en unités Halo : `forward` sur
 * l'axe du cap, `left` à sa gauche. `order` est son rang dans `vehicleActiveRides` (conducteur
 * d'abord) : le premier au centre un peu en arrière, les suivants par rangées de deux derrière lui.
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

/** rotateOffset — un décalage du repère du véhicule ramené au monde Halo (cap en degrés). */
export function rotateOffset(off: { forward: number; left: number }, headingDeg: number): { dx: number; dy: number } {
  const h = (headingDeg * Math.PI) / 180
  const c = Math.cos(h)
  const s = Math.sin(h)
  return { dx: off.forward * c - off.left * s, dy: off.forward * s + off.left * c }
}

/** Un épisode d'occupation nommé par son xuid, rattaché à sa monture. */
export interface RiderEpisode {
  /** Rang de la monture dans la liste passée à `buildRiderIndex`. */
  vehicle: number
  ride: ReplayVehicleRide
}

/**
 * buildRiderIndex — les épisodes PAR XUID, sur les seules vies qui peuvent porter un joueur
 * (`vehicleCanEmbark` : ni décor, ni châssis non résolu, ni élément de carte). Même filtre que le
 * prédicat embarqué et la position d'un porteur en 2D.
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

/** La monture d'un joueur à une image : la vie et son rang parmi les occupants actifs. */
export interface RiderSeat {
  vehicle: number
  order: number
}

/**
 * riderSeatAt — où est assis `xuid` à `frame` : un épisode qui couvre l'image, sur un véhicule
 * dans sa fenêtre d'affichage (`vehicleVisibleAt`), et son rang parmi les occupants actifs ; null
 * s'il n'est à bord de rien.
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
