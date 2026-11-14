/**
 * playerMarkers3d_logic.ts — pure geometry of the top-down player markers: which way each
 * living player's disc faces, how a player on another floor than the drawn one is dimmed and
 * chevroned, and the marker's size on screen.
 *
 * Scene axes: X/Z on the floor, Y up (three.js). A marker keeps a fixed size in screen pixels
 * whatever the map's extent, so it reads the same on a small arena and on a big team map.
 */
import { CUT_HEADROOM } from './topDownLogic'

/** Radius of a marker disc on screen (CSS px). */
export const MARKER_RADIUS_PX = 9
/** Opacity of a marker (and its tag) on another floor than the drawn one. */
export const DIMMED_MARKER_OPACITY = 0.45
/**
 * How far under the followed player's floor (u) a player stands before he counts as on a
 * lower floor: past a flight of stairs, short of the next storey (Halo storeys are ~2 u apart).
 */
export const LOWER_FLOOR_DROP = 1.2

/** The marker state of one player at a frame. */
export interface MarkerGeometry {
  /** Marker and tag opacity: 1 on the drawn floor, dimmed on another. */
  opacity: number
  /** A player on another floor: above the cut or well below the drawn floor; null on it. */
  chevron: 'above' | 'below' | null
  /** Facing on the floor, a unit XZ direction (three axes). */
  dirX: number
  dirZ: number
}

/** What the scene knows of one living player at a frame, in scene axes. */
export interface TopDownPlayerInput {
  /** Scene Y of the feet. */
  y: number
  /** Yaw in degrees, the same convention as the tracks. */
  heading: number
}

/**
 * topDownMarkers — the marker state of each living player, in input order, against the cut
 * height `cutY`. Above the cut (his floor is not drawn) a player is dimmed and chevroned up;
 * more than `LOWER_FLOOR_DROP` under the drawn floor (the cut less its headroom) he is dimmed
 * and chevroned down.
 */
export function topDownMarkers(players: readonly TopDownPlayerInput[], cutY: number): MarkerGeometry[] {
  const floorY = cutY - CUT_HEADROOM
  return players.map((p) => {
    const [dirX, dirZ] = dirOf(p.heading)
    const chevron = p.y > cutY ? 'above' : p.y < floorY - LOWER_FLOOR_DROP ? 'below' : null
    return { opacity: chevron ? DIMMED_MARKER_OPACITY : 1, chevron, dirX, dirZ }
  })
}

/** dirOf — a yaw (degrees) as a unit XZ direction on the floor, in three axes. */
function dirOf(hDeg: number): [number, number] {
  const h = (hDeg * Math.PI) / 180
  return [Math.cos(h), -Math.sin(h)]
}

/**
 * unitsPerPixel — world units per CSS pixel of an orthographic view `halfHeight` units tall
 * (half) on a viewport `viewportPx` CSS pixels tall; 0 for an empty viewport.
 */
export function unitsPerPixel(halfHeight: number, viewportPx: number): number {
  return viewportPx > 0 ? (2 * halfHeight) / viewportPx : 0
}
