/**
 * minimapLogic.ts — pure math of the corner minimap over the 3D view: a square of fixed world size
 * centered on the followed player with a fixed north-up orientation (screen up is scene -Z, the
 * axes the 2D top-down view draws the map in), its place on screen, and when its cached top-down
 * image of the map around him must be redone.
 *
 * The image is rendered at a low rate over a square twice the minimap's span, centered where the
 * player was; between renders the minimap reads its turned square out of it around where he is now.
 * The turned square reaches `SPAN * sqrt(2) / 2` from him, so he may stray `RECENTER_SHARE * SPAN`
 * from the image center (plus what he covers between two renders) and the square stays inside it.
 *
 * Axes: scene X/Z on the floor (screen right is +X, screen down is +Z in an image seen from above);
 * yaw in degrees, the tracks' convention (`dirOf`).
 */
import { dirOf } from './playerMarkers3d_logic'
import { INSET_GAP_PX, type Insets, type Viewport } from './topDownNavLogic'

/** The world span across the minimap (u, ~120 m): most of an arena, a neighborhood of a team map. */
export const MINIMAP_SPAN_U = 40
/** The cached image's span: twice the minimap's, room for the turned square and the player's drift. */
export const MINIMAP_IMAGE_SPAN_U = 2 * MINIMAP_SPAN_U
/** How far (share of the span) the player strays from the image center before it is redone. */
export const RECENTER_SHARE = 0.15
/**
 * How far the cut moves (u) before the image is redone: half a storey (Halo storeys are ~2 u apart),
 * so a jump, which lifts the smoothed cut by a fraction of a unit, does not redo it.
 */
export const CUT_STEP_U = 1
/**
 * The image is redone at most this often (ms), a moved player or cut waiting for it: one render of
 * the whole map costs about a top-down frame (Recharge: 9 to 26 ms measured on a loaded machine).
 */
export const MIN_RENDER_INTERVAL_MS = 500
/** The minimap's side as a share of the view's height, and its distance from the right edge (CSS px). */
export const MINIMAP_SCREEN_SHARE = 0.24
export const MINIMAP_RIGHT_PX = 16
/**
 * The yaw (degrees) facing screen up (scene -Z): the minimap's fixed orientation, the same axes
 * the 2D top-down view frames the map in (`topDownView3d` sets the camera's up to scene -Z).
 */
export const SCREEN_UP_HEADING_DEG = 90

/** The cached image: the square it covers (center, scene X/Z), the cut it was drawn at, when, and for whom. */
export interface MinimapImage {
  center: [number, number]
  cutY: number
  at: number
  followed: string
}

/** minimapStale — whether the cached image must be redone for the player at `center` (scene X/Z) and the cut `cutY`. */
export function minimapStale(img: MinimapImage | null, now: MinimapImage): boolean {
  if (!img || img.followed !== now.followed) return true
  if (now.at - img.at < MIN_RENDER_INTERVAL_MS) return false
  const drift = Math.hypot(now.center[0] - img.center[0], now.center[1] - img.center[1])
  return drift > RECENTER_SHARE * MINIMAP_SPAN_U || Math.abs(now.cutY - img.cutY) > CUT_STEP_U
}

/** Where the minimap looks: the player's feet (scene X/Z) and his yaw (degrees). */
export interface MinimapPose {
  center: [number, number]
  heading: number
}

/** The player's facing (forward) and right on the floor, scene X/Z, seen from above. */
function axesOf(heading: number): { f: [number, number]; r: [number, number] } {
  const f = dirOf(heading)
  return { f, r: [-f[1], f[0]] }
}

/**
 * minimapPoint — a scene point (X, Z) on the minimap, in minimap units: (right, up) from its center,
 * the span being 1; the minimap shows [-0.5, 0.5] on both.
 */
export function minimapPoint(pose: MinimapPose, x: number, z: number): [number, number] {
  const { f, r } = axesOf(pose.heading)
  const dx = x - pose.center[0]
  const dz = z - pose.center[1]
  return [(dx * r[0] + dz * r[1]) / MINIMAP_SPAN_U, (dx * f[0] + dz * f[1]) / MINIMAP_SPAN_U]
}

/** minimapAngle — the angle (radians, counterclockwise from the minimap's up) of a scene yaw on the minimap. */
export function minimapAngle(pose: MinimapPose, heading: number): number {
  const [x, z] = dirOf(heading)
  const [right, up] = minimapPoint({ ...pose, center: [0, 0] }, x, z)
  return Math.atan2(-right, up)
}

/**
 * minimapUvRows — the affine map from the minimap quad's (u, v) in [0, 1] (v up) to the cached
 * image's (u, v) (v = 0 on its +Z edge), as two rows [a, b, c] with image = a * u + b * v + c.
 */
export function minimapUvRows(pose: MinimapPose, image: [number, number]): [[number, number, number], [number, number, number]] {
  const { f, r } = axesOf(pose.heading)
  const k = MINIMAP_SPAN_U / MINIMAP_IMAGE_SPAN_U
  const ox = (pose.center[0] - image[0]) / MINIMAP_IMAGE_SPAN_U
  const oz = (pose.center[1] - image[1]) / MINIMAP_IMAGE_SPAN_U
  return [
    [k * r[0], k * f[0], 0.5 + ox - (k * (r[0] + f[0])) / 2],
    [-k * r[1], -k * f[1], 0.5 - oz + (k * (r[1] + f[1])) / 2],
  ]
}

/** The minimap's square on the canvas: left, top (CSS px) and side. */
export interface MinimapRect {
  left: number
  top: number
  side: number
}

/**
 * minimapRect — top right, under the top strip's place, `MINIMAP_SCREEN_SHARE` of the view's height.
 * The first-person HUD keeps the other corners: the kill feed bottom left (where the game's motion
 * tracker sits under it), the weapon bottom right, the camera choice top left.
 */
export function minimapRect(view: Viewport, insets: Insets): MinimapRect {
  const side = Math.round(view.height * MINIMAP_SCREEN_SHARE)
  return { left: view.width - MINIMAP_RIGHT_PX - side, top: Math.max(insets.top, INSET_GAP_PX), side }
}

/** minimapHit — a canvas point (x, y in CSS px from the canvas's top left) on the minimap's square. */
export function minimapHit(rect: MinimapRect, x: number, y: number): boolean {
  return x >= rect.left && x < rect.left + rect.side && y >= rect.top && y < rect.top + rect.side
}
