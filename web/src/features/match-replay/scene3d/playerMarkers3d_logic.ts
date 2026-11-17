// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * playerMarkers3d_logic.ts — pure geometry of the top-down player markers: which way each
 * living player's disc faces, how a player on another floor than the drawn one is dimmed and
 * given a level arrow, the marker's size on screen, and where each name tag goes so tags do not pile up.
 *
 * Scene axes: X/Z on the floor, Y up (three.js). A marker keeps a fixed size in screen pixels
 * whatever the map's extent or the zoom, so it reads the same on a small arena and on a big team map.
 */
import { CUT_HEADROOM } from './topDownLogic'

/** Radius of a marker disc on screen (CSS px). */
export const MARKER_RADIUS_PX = 9
/**
 * Opacity of a marker (and its tag) on another floor than the drawn one: a modest step down, so a
 * player upstairs or downstairs still reads at a glance; his level arrow (`levelArrow`) says which.
 */
export const DIMMED_MARKER_OPACITY = 0.75
/**
 * How far under the followed player's floor (u) a player stands before he counts as on a
 * lower floor: past a flight of stairs, short of the next storey (Halo storeys are ~2 u apart).
 */
export const LOWER_FLOOR_DROP = 1.2
/** The tag's center above (or below) the marker's on screen (CSS px): a radius, a gap, half a tag. */
export const TAG_OFFSET_PX = MARKER_RADIUS_PX + 16
/** Space kept between two tags (CSS px). */
const TAG_GAP_PX = 2

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

/** floorOf — a height against the cut: above it, on the drawn floor, or well below it. */
export function floorOf(y: number, cutY: number): 'above' | 'below' | null {
  const floorY = cutY - CUT_HEADROOM
  return y > cutY ? 'above' : y < floorY - LOWER_FLOOR_DROP ? 'below' : null
}

/**
 * topDownMarkers — the marker state of each living player, in input order, against the followed
 * player's cut `cutY` (a headroom over his feet). Above it a player is on a floor over his: dimmed
 * and chevroned up; more than `LOWER_FLOOR_DROP` under his floor (the cut less its headroom) he
 * is dimmed and chevroned down.
 */
export function topDownMarkers(players: readonly TopDownPlayerInput[], cutY: number): MarkerGeometry[] {
  return players.map((p) => {
    const [dirX, dirZ] = dirOf(p.heading)
    const chevron = floorOf(p.y, cutY)
    return { opacity: chevron ? DIMMED_MARKER_OPACITY : 1, chevron, dirX, dirZ }
  })
}

/**
 * levelArrow — the arrow drawn inside the marker disc of a player on another floor: its direction
 * on the scene's Z axis, which is the screen's vertical in the top-down view (scene -Z is screen up):
 * -1 points up (his floor is above the drawn one), 1 points down (below it), 0 draws no arrow.
 */
export function levelArrow(chevron: MarkerGeometry['chevron']): -1 | 0 | 1 {
  return chevron === 'above' ? -1 : chevron === 'below' ? 1 : 0
}

/** dirOf — a yaw (degrees) as a unit XZ direction on the floor, in three axes. */
export function dirOf(hDeg: number): [number, number] {
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

/** One name tag to place: its marker's screen point, its size (CSS px), its rank (lower first). */
export interface TagBox {
  x: number
  y: number
  w: number
  h: number
  rank: number
}

/** Where a tag goes: over its marker, under it, or nowhere (no free place). */
export type TagPlace = 'above' | 'below' | 'hidden'

interface Rect {
  x0: number
  y0: number
  x1: number
  y1: number
}

function rectOf(t: TagBox, dy: number): Rect {
  return { x0: t.x - t.w / 2, x1: t.x + t.w / 2, y0: t.y + dy - t.h / 2, y1: t.y + dy + t.h / 2 }
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x0 < b.x1 + TAG_GAP_PX && b.x0 < a.x1 + TAG_GAP_PX && a.y0 < b.y1 + TAG_GAP_PX && b.y0 < a.y1 + TAG_GAP_PX
}

/**
 * declutterTags — place the tags in rank order (ties in input order): each goes over its marker,
 * or under it if that place is taken by a tag already placed, or is hidden when both are. So the
 * followed player's tag and those on the drawn floor (ranked first by the caller) always show, and
 * a tag only moves or goes for one that outranks it. Results in input order.
 */
export function declutterTags(tags: readonly TagBox[]): TagPlace[] {
  const order = tags.map((_, i) => i).sort((a, b) => tags[a].rank - tags[b].rank || a - b)
  const placed: Rect[] = []
  const out: TagPlace[] = tags.map(() => 'hidden')
  for (const i of order) {
    const t = tags[i]
    for (const [place, dy] of [['above', -TAG_OFFSET_PX], ['below', TAG_OFFSET_PX]] as const) {
      const r = rectOf(t, dy)
      if (placed.some((p) => overlaps(p, r))) continue
      placed.push(r)
      out[i] = place
      break
    }
  }
  return out
}
