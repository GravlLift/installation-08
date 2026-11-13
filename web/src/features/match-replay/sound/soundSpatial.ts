/**
 * soundSpatial.ts — LA PLACE D'UN SON DANS L'ESPACE : son niveau et son côté pour qui écoute.
 *
 * Repère de la carte, z vers le haut : seul le plan horizontal compte. Le cap suit la convention
 * du document (`h` en degrés, 0 vers +X, 90 vers +Y), celle que `aimDirThree` tourne en direction
 * de caméra : la droite de l'auditeur est donc (sin h, -cos h).
 *
 * Pas de Web Audio ici : géométrie pure, testable (soundSpatial.test.ts).
 */
import type { ReplaySoundEvent } from './replaySoundVariants'

/** Distance, en unités de carte, jusqu'à laquelle un son garde son plein niveau. */
export const SPATIAL_FULL_RADIUS = 3
/**
 * Largeur stéréo maximale : un son plein côté garde près de 40 % de son niveau dans l'autre
 * oreille, comme une tête entre deux oreilles, jamais un canal muet.
 */
export const SPATIAL_PAN_WIDTH = 0.5
/** Distance en deçà de laquelle un son n'a pas de côté. */
export const SPATIAL_CENTER_RADIUS = 0.5

/** Qui écoute : sa position dans la carte et son cap en degrés. */
export interface SoundListener {
  x: number
  y: number
  heading: number
}

/** D'où vient le son, dans la carte. */
export interface SoundSource {
  x: number
  y: number
}

/** Le placement d'une voix : `gain` dans ]0, 1], `pan` dans [-1, 1], positif à DROITE. */
export interface SoundPlacement {
  gain: number
  pan: number
}

const CENTERED: SoundPlacement = { gain: 1, pan: 0 }

/**
 * spatialOf place un son pour un auditeur. `own` : le son est celui de l'auditeur lui-même, il
 * sonne plein et au centre. Sinon le niveau décroît en inverse de la distance au-delà de
 * SPATIAL_FULL_RADIUS, sans plancher, et le côté est le sinus du gisement.
 */
export function spatialOf(listener: SoundListener, source: SoundSource, own: boolean): SoundPlacement {
  if (own) return CENTERED
  const dx = source.x - listener.x
  const dy = source.y - listener.y
  const d = Math.hypot(dx, dy)
  const gain = d <= SPATIAL_FULL_RADIUS ? 1 : SPATIAL_FULL_RADIUS / d
  if (d <= SPATIAL_CENTER_RADIUS) return { gain, pan: 0 }
  const h = (listener.heading * Math.PI) / 180
  const side = (dx * Math.sin(h) - dy * Math.cos(h)) / d
  return { gain, pan: side * SPATIAL_PAN_WIDTH }
}

/**
 * placeOf — le placement d'un événement sonore pour un auditeur. `undefined` sans auditeur ou
 * sans lieu : le son joue alors tel quel, comme avant. Sinon le son est AUTRUI : jamais le son
 * de l'auditeur lui-même, qui resterait plein et au centre.
 */
export function placeOf(
  listener: SoundListener | null,
  event: Pick<ReplaySoundEvent, 'at'>,
): SoundPlacement | undefined {
  if (!listener || !event.at) return undefined
  return spatialOf(listener, event.at, false)
}
