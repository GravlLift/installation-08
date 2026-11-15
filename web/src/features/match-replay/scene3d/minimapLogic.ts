/**
 * minimapLogic.ts — pure math of the corner minimap over the 3D view: a square of fixed world size
 * centered on the followed player with a fixed north-up orientation (screen up is scene -Z, the
 * axes the 2D top-down view draws the map in), its place on screen, and the cached top-down image
 * of the map it reads from.
 *
 * The image is the whole walked area at the picture's fixed cut, rendered once (and again only when
 * the scene graph changes): the minimap reads its square out of it around the player at every frame,
 * so playing never re-renders the map (each re-render of a moving 80 u image was a whole-map draw,
 * the worst frames of a heavy variant layer). The image reaches `SPAN * sqrt(2) / 2` past the walked
 * area on every side, so the square, even turned, stays inside it.
 *
 * Axes: scene X/Z on the floor (screen right is +X, screen down is +Z in an image seen from above);
 * yaw in degrees, the tracks' convention (`dirOf`).
 */
import { dirOf } from './playerMarkers3d_logic'
import { INSET_GAP_PX, type Insets, type Viewport } from './topDownNavLogic'

/** The world span across the minimap (u, ~120 m): most of an arena, a neighborhood of a team map. */
export const MINIMAP_SPAN_U = 40
/** The cached image's density (px per u): sharp on the minimap at a pixel ratio of 2. */
export const MINIMAP_IMAGE_PX_PER_U = 12.8
/** The cached image's side bounds (px): a wide walked area gets a softer image, not a larger one. */
export const MINIMAP_IMAGE_MIN_PX = 512
export const MINIMAP_IMAGE_MAX_PX = 2048
/** The minimap's side as a share of the view's height, and its distance from the right edge (CSS px). */
export const MINIMAP_SCREEN_SHARE = 0.24
export const MINIMAP_RIGHT_PX = 16
/**
 * The yaw (degrees) facing screen up (scene -Z): the minimap's fixed orientation, the same axes
 * the 2D top-down view frames the map in (`topDownView3d` sets the camera's up to scene -Z).
 */
export const SCREEN_UP_HEADING_DEG = 90

/** The cached image: the square it covers (center, scene X/Z, and side, u) and its side in pixels. */
export interface MinimapImage {
  center: [number, number]
  side: number
  px: number
}

/** The walked area seen from above (scene X/Z). */
export interface MinimapBounds {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/** minimapImageOf — the cached image of the walked area `b`: a square around it with room for the minimap's turned square. */
export function minimapImageOf(b: MinimapBounds): MinimapImage {
  const side = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 0) + MINIMAP_SPAN_U * Math.SQRT2
  const px = Math.min(MINIMAP_IMAGE_MAX_PX, Math.max(MINIMAP_IMAGE_MIN_PX, Math.ceil(side * MINIMAP_IMAGE_PX_PER_U)))
  return { center: [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2], side, px }
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
export function minimapUvRows(pose: MinimapPose, image: Pick<MinimapImage, 'center' | 'side'>): [[number, number, number], [number, number, number]] {
  const { f, r } = axesOf(pose.heading)
  const k = MINIMAP_SPAN_U / image.side
  const ox = (pose.center[0] - image.center[0]) / image.side
  const oz = (pose.center[1] - image.center[1]) / image.side
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
