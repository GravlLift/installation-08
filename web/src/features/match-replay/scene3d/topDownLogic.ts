/**
 * topDownLogic.ts — pure logic of the top-down view: floor bands from the heights players
 * stood at, the band containing a height, and the orthographic frame that fits the played
 * area in a view of a given aspect.
 *
 * Heights are world units on the SCENE's up axis (three.js Y). The replay document publishes
 * them on its own up axis (Halo Z); `toThree` maps document Z to scene Y, so callers pass
 * the document's Z values straight through.
 */

/** The drawing view of the scene: perspective (3D) or the orthographic top-down view. */
export type SceneView3d = '3d' | 'top'

/** The two drawing bounds of one floor. */
export interface FloorBand {
  /** Lowest drawn height: the lowest standing height of the cluster minus a margin. */
  floorY: number
  /** Highest drawn height: the highest standing height of the cluster plus headroom. */
  ceilingY: number
}

/** Margin below the lowest standing height of a floor (u). */
const FLOOR_MARGIN = 0.5
/** Headroom above the highest standing height: a standing Spartan plus aim (u). */
const STAND_HEADROOM = 2.5
/** Keep a band's ceiling this far under the next band's floor, so the clip never reaches it (u). */
const BAND_CLEARANCE = 0.01

/**
 * floorBands — cluster the heights into floors: sort, split where two consecutive heights
 * are more than `gap` apart, one band per cluster. A ramp (continuously spread heights)
 * stays in one band. Where the headroom of one cluster reaches the next one's floor, the
 * lower ceiling is capped under it: the clip must never reach the floor above.
 */
export function floorBands(heights: number[], gap: number): FloorBand[] {
  if (heights.length === 0) return []
  const sorted = [...heights].sort((a, b) => a - b)
  const bands: FloorBand[] = []
  let start = 0
  for (let i = 1; i <= sorted.length; i++) {
    const last = i === sorted.length
    if (last || sorted[i] - sorted[i - 1] > gap) {
      bands.push({ floorY: sorted[start] - FLOOR_MARGIN, ceilingY: sorted[i - 1] + STAND_HEADROOM })
      start = i
    }
  }
  for (let i = 0; i < bands.length - 1; i++) {
    if (bands[i].ceilingY >= bands[i + 1].floorY) bands[i].ceilingY = bands[i + 1].floorY - BAND_CLEARANCE
  }
  return bands
}

/** bandAt — the band containing the height `y`, else the nearest one (by band center). */
export function bandAt(bands: readonly FloorBand[], y: number): FloorBand {
  let best = bands[0]
  let bestDist = Infinity
  for (const band of bands) {
    if (y >= band.floorY && y <= band.ceilingY) return band
    const dist = Math.abs((band.floorY + band.ceilingY) / 2 - y)
    if (dist < bestDist) { bestDist = dist; best = band }
  }
  return best
}

/** The X/Z extent of the played area, margins already applied by the caller (u). */
export interface TopDownBounds {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/** The orthographic frame: the half-width and half-height that fit the area, and its center. */
export interface TopDownFrame {
  /** Center of the played area, (X, Z). */
  center: [number, number]
  halfWidth: number
  halfHeight: number
}

/**
 * topDownFrame — fit the X/Z bounds in a view of `aspect` (width over height): the
 * half-width is the larger of the area's half-width and the half-depth the aspect asks
 * for, the half-height follows from it, so the whole area is on screen.
 */
export function topDownFrame(bounds: TopDownBounds, aspect: number): TopDownFrame {
  const w = bounds.maxX - bounds.minX
  const d = bounds.maxZ - bounds.minZ
  const halfWidth = Math.max(w / 2, (d / 2) * aspect)
  return { center: [(bounds.minX + bounds.maxX) / 2, (bounds.minZ + bounds.maxZ) / 2], halfWidth, halfHeight: halfWidth / aspect }
}
