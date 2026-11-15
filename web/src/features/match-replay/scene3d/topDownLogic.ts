/**
 * topDownLogic.ts — pure logic of the top-down view: the lowest and highest drawn heights (the
 * map picture is cut once, a headroom over the highest walked floor, so it never changes during
 * playback), which map surfaces the top-down views leave out (`hiddenFromTop`), and the followed
 * player's floor height over time (`CutFollower`), against which the markers tell a player on
 * another floor (`playerMarkers3d_logic.floorOf`). The framing (zoom, pan, chrome) is
 * `topDownNavLogic`.
 *
 * The followed floor follows a player, not a floor table: on a map whose floors are joined by
 * ramps the walked heights are continuous, so no clustering of them can tell one floor from
 * another. The cut sits a head and a clearance above the feet of the followed player. It used to
 * cut the map picture too; that made the map change shape as he moved, and it now only places
 * the markers' floor test.
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

/**
 * CutFollower — the cut of one top-down view over time: `cutTarget` for the frame's players,
 * smoothed since the last step; the followed player's feet are remembered while he is out of life.
 */
export class CutFollower {
  private cut: number | null = null
  private at = 0
  private last: { xuid: string | null; y: number | null } = { xuid: null, y: null }
  private readonly lowestY: number

  constructor(lowestY: number) {
    this.lowestY = lowestY
  }

  /** Start over: the next step lands on its target. */
  reset(): void {
    this.cut = null
    this.last = { xuid: null, y: null }
  }

  /** The cut at `nowMs`: `followedY` his feet (null out of life or without him), `livingY` everyone's. */
  step(nowMs: number, followed: string | null, followedY: number | null, livingY: readonly number[]): number {
    if (followed !== this.last.xuid) this.last = { xuid: followed, y: null }
    if (followedY !== null) this.last.y = followedY
    const target = cutTarget({ followedY, lastFollowedY: this.last.y, livingY, previous: this.cut, lowestY: this.lowestY })
    this.cut = smoothCut(this.cut, target, (nowMs - this.at) / 1000)
    this.at = nowMs
    return this.cut
  }
}

/** What the top-down view knows of one map surface to decide whether it draws. */
export interface TopSurface {
  /** The view's family (`tagSurface`): 'structure', 'decor', 'seeThrough'; null when untagged. */
  family: string | null
  /** One mesh drawn many times (a terrain's grass and foliage clumps). */
  instanced: boolean
  /** Its material blends over what is behind it (decals, light cards, glass). */
  transparent: boolean
  /** Its material is cut out by its texture's alpha (glTF MASK, `alphaTest`): leaves, ivy, grates. */
  cutout: boolean
  /** It belongs to the match's Forge object layer (`variant.glb`), not to the map itself. */
  objectLayer: boolean
  /** The share of its area facing straight up or down (`flatShare`); read for a map cutout only. */
  flat: number
}

/**
 * The share of a map cutout's area that must lie flat for it to stay: a grate or a mesh floor is
 * nearly all flat, leaves and branches stand at every angle.
 */
export const FLAT_CUTOUT_SHARE = 0.7

/**
 * hiddenFromTop — whether a map surface is left out of the top-down views (2D view and minimap):
 * the layout reads without what only dresses it. Out: the scattered foliage clumps, the coarse
 * decor (the `decor*` nodes, told by the grain of their mesh, which the map-images top-down
 * renderer drops too: `EstDecorGrossier`), everything laid over the surface behind it (decals,
 * light cards, glass), every cutout of the Forge object layer (its ivy patches, plants, shrubs and
 * leaves: a Forge layer's cutout is foliage, its floors are solid), and a map cutout that does not
 * lie flat (foliage cards in the map, where a flat cutout is a grate or a mesh floor and stays).
 * The structure, the terrain and the solid placed objects stay. An untagged mesh (a helper) is
 * not this rule's to decide.
 */
export function hiddenFromTop(s: TopSurface): boolean {
  if (s.instanced) return true
  if (s.family === null) return false
  if (s.family === 'decor' || s.family === 'seeThrough' || s.transparent) return true
  if (!s.cutout) return false
  return s.objectLayer || s.flat < FLAT_CUTOUT_SHARE
}

/** A face counts as flat when its normal is this close to vertical (cosine: about 25 degrees). */
const FLAT_NORMAL = 0.9

/**
 * flatShare — the share of a mesh's area whose faces lie flat (normal within ~25 degrees of
 * vertical, either way up): `positions` are world X, Y, Z triples, `index` three per triangle
 * (null: the positions taken three by three). 0 for a mesh without area.
 */
export function flatShare(positions: ArrayLike<number>, index: ArrayLike<number> | null): number {
  const count = index ? index.length : positions.length / 3
  let flat = 0
  let total = 0
  for (let t = 0; t + 2 < count; t += 3) {
    const [a, b, c] = [0, 1, 2].map((k) => 3 * (index ? index[t + k] : t + k))
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2]
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const area = Math.hypot(nx, ny, nz)
    if (!(area > 0)) continue
    total += area
    if (Math.abs(ny) / area >= FLAT_NORMAL) flat += area
  }
  return total > 0 ? flat / total : 0
}

/** The walked height span of a match (scene Y): its lowest and highest walked heights. */
export interface HeightSpan {
  low: number
  high: number
}

/** walkedSpan — the lowest and highest walked heights; both 0 without any. */
export function walkedSpan(heights: readonly number[]): HeightSpan {
  let low = Infinity
  let high = -Infinity
  for (const h of heights) {
    if (h < low) low = h
    if (h > high) high = h
  }
  return Number.isFinite(low) ? { low, high } : { low: 0, high: 0 }
}

/** lowestDrawn — the lowest height drawn: the lowest walked height minus the floor margin. */
export function lowestDrawn(heights: readonly number[]): number {
  let lowest = Infinity
  for (const h of heights) if (h < lowest) lowest = h
  return (Number.isFinite(lowest) ? lowest : 0) - FLOOR_MARGIN
}

/** highestDrawn — the top of the highest walked floor's headroom: the fixed cut of the top-down map picture. */
export function highestDrawn(heights: readonly number[]): number {
  let highest = -Infinity
  for (const h of heights) if (h > highest) highest = h
  return (Number.isFinite(highest) ? highest : 0) + CUT_HEADROOM
}
