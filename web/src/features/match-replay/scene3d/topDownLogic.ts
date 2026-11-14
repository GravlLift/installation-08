/**
 * topDownLogic.ts — pure logic of the top-down view: the cut height (everything above it is
 * not drawn), its smoothing over time, the lowest drawn height, and the orthographic frame that
 * fits the played area in a view of a given aspect.
 *
 * The cut follows a player, not a floor table: on a map whose floors are joined by ramps the
 * walked heights are continuous, so no clustering of them can tell one floor from another. The
 * cut sits a head and a clearance above the feet of the followed player, so the floor he stands
 * on shows with what lies below it through openings, and every slab over his head is gone.
 *
 * Heights are world units on the SCENE's up axis (three.js Y). The replay document publishes
 * them on its own up axis (Halo Z); `toThree` maps document Z to scene Y, so callers pass
 * the document's Z values straight through.
 */
import { HEAD_TOP } from './body3d'

/** The drawing view of the scene: perspective (3D) or the orthographic top-down view. */
export type SceneView3d = '3d' | 'top'

/** Clearance between the top of a standing Spartan's head and the cut (u, ~0.9 m). */
export const CUT_CLEARANCE = 0.3
/** The cut height above the feet it follows: a standing Spartan plus the clearance (u). */
export const CUT_HEADROOM = HEAD_TOP + CUT_CLEARANCE
/**
 * Time constants of the cut's smoothing (s). It rises slowly, so a jump does not lift it into
 * the ceiling, and falls fast, so the floor a player has just walked down from does not cover
 * him for long.
 */
export const CUT_RISE_S = 0.6
export const CUT_FALL_S = 0.2
/** Margin kept drawn under the lowest walked height (u); below it is terrain and backdrop. */
export const FLOOR_MARGIN = 0.5

/** What the cut follows at a frame, scene Y of feet. */
export interface CutSource {
  /** The followed player's feet, null without a followed player or while he is out of life. */
  followedY: number | null
  /** The followed player's feet when last seen alive, null if never (or in free camera). */
  lastFollowedY: number | null
  /** The feet of every living player. */
  livingY: readonly number[]
  /** The cut drawn at the previous frame, null before the first. */
  previous: number | null
  /** The lowest walked height of the match, the last resort when nothing else is known. */
  lowestY: number
}

/**
 * cutTarget — the height the cut moves to: a headroom over the followed player's feet; while
 * he is out of life, over the feet he was last seen on; in free camera (or before he was ever
 * seen) over the median feet of the living players; with nobody alive, the previous cut, else
 * a headroom over the lowest walked height.
 */
export function cutTarget(src: CutSource): number {
  const feet = src.followedY ?? src.lastFollowedY ?? (src.livingY.length > 0 ? median(src.livingY) : null)
  if (feet !== null) return feet + CUT_HEADROOM
  return src.previous ?? src.lowestY + CUT_HEADROOM
}

/** median — the middle value (mean of the two middle ones for an even count); NaN when empty. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * smoothCut — move the cut from `previous` toward `target` over `dtSeconds` (exponential,
 * `CUT_RISE_S` up, `CUT_FALL_S` down); the first cut (previous null) lands on the target.
 */
export function smoothCut(previous: number | null, target: number, dtSeconds: number): number {
  if (previous === null || !(dtSeconds > 0)) return previous ?? target
  const tau = target > previous ? CUT_RISE_S : CUT_FALL_S
  return previous + (target - previous) * (1 - Math.exp(-dtSeconds / tau))
}

/** lowestDrawn — the lowest height drawn: the lowest walked height minus the floor margin. */
export function lowestDrawn(heights: readonly number[]): number {
  let lowest = Infinity
  for (const h of heights) if (h < lowest) lowest = h
  return (Number.isFinite(lowest) ? lowest : 0) - FLOOR_MARGIN
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
