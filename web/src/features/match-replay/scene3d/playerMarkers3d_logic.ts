/**
 * playerMarkers3d_logic.ts — pure geometry of the top-down player markers: where each living
 * player's disc sits and which way it faces, and how a player on a floor other than the one
 * being drawn is dimmed and chevroned.
 *
 * Scene axes: X/Z on the floor, Y up (three.js). Sizes are world units; the disc radius is the
 * body radius times a named factor so a marker scales with the map like the bodies do.
 */
import { BODY_RADIUS } from './body3d'
import { bandAt, type FloorBand } from './topDownLogic'

/** How many body radii a marker disc is across. */
export const MARKER_SIZE_FACTOR = 2.0
/** Opacity of a marker (and its tag) on a floor other than the drawn one. */
export const DIMMED_MARKER_OPACITY = 0.4

/** The marker state of one player at a frame. */
export interface MarkerGeometry {
  /** Drawn for living players only. */
  visible: boolean
  /** Marker and tag opacity: 1 in the drawn band, dimmed in another. */
  opacity: number
  /** A player in another band: above or below the drawn floor; null in-band. */
  chevron: 'above' | 'below' | null
  /** Facing on the floor, a unit XZ direction (three axes). */
  dirX: number
  dirZ: number
}

/** What the scene knows of one player at a frame, in scene axes. */
export interface TopDownPlayerInput {
  xuid: string
  /** Scene Y of the feet. */
  y: number
  /** Yaw in degrees, the same convention as the tracks. */
  heading: number
  alive: boolean
}

/**
 * topDownMarkers — the marker state of each player, in input order. `bands` and the drawn
 * `band` are the same objects the top-down view uses, so a player in the drawn band is told by
 * band identity; in another band the marker and tag dim and a chevron names the direction.
 */
export function topDownMarkers(
  players: readonly TopDownPlayerInput[],
  bands: readonly FloorBand[],
  band: FloorBand | null,
): MarkerGeometry[] {
  return players.map((p) => {
    const [dx, , dz] = dirOf(p.heading)
    if (!p.alive || !band || bands.length === 0) {
      return { visible: p.alive && !!band, opacity: 1, chevron: null, dirX: dx, dirZ: dz }
    }
    const own = bandAt(bands, p.y)
    const inBand = own === band
    return {
      visible: true,
      opacity: inBand ? 1 : DIMMED_MARKER_OPACITY,
      chevron: inBand ? null : own.floorY > band.floorY ? 'above' : 'below',
      dirX: dx,
      dirZ: dz,
    }
  })
}

/** dirOf — a yaw (degrees) as a unit XZ direction on the floor, in three axes. */
function dirOf(hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180
  return [Math.cos(h), 0, -Math.sin(h)]
}

/** The marker disc radius (world units), from the body radius. */
export const MARKER_RADIUS = BODY_RADIUS * MARKER_SIZE_FACTOR
