// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * floorRings.ts — THE REPLAY'S FLOOR LANGUAGE: concentric rings, one per floor above the
 * ground. ONE SINGLE IMPLEMENTATION, shared by the pawns (`replayMarkers.ts`) and by the mode
 * objectives (`objectivesLayer.ts`, lot of 2026-09-18).
 *
 * THE DOCTRINE COMES FROM THE PAWNS (board of 2026-08-16, A1 of 2026-08-18) and does not
 * change when extended to the objectives: never a marker offset (in top view, moving a point
 * to the top of the screen would mean "further north"), altitude is a STEP and not a
 * gradient, it is the NUMBER of rings that states the height and it alone — the color only
 * says the team. A flag pedestal on a floor therefore carries exactly what a player on a
 * floor carries.
 *
 * WHY A FILE, AND NOT AN EXPORT OF `replayMarkers.ts`: the objectives are cooked off-screen,
 * with no document nor current frame; importing the pawns module for three constants and a
 * loop would have dragged in the aim cone, the labels and the chevrons. The repository rule
 * (<= 2 copies of a pattern, the 3rd is centralized) applies from the SECOND one here: two
 * ring loops would diverge at the first tuning, and the gap would be invisible because it
 * would look plausible.
 *
 * THE FIRST RADIUS IS A PARAMETER, the step is not. The pawn places its first ring at
 * `FLOOR_RING_RADIUS` (6.5 px, detached from the point); an objective marker already carries
 * a DELIVERY ring at 8 px and must place its own beyond it, otherwise the two would blend.
 * The STEP between rings, however, is the same everywhere: that is what the eye counts.
 */
import { floorOf, type XY } from '../../../lib/replay/replayLogic'

/**
 * Vertical span below which the terrain is FLAT: `altitudeRatio` then returns 0.5 by
 * convention and `floorOf` floor 1, which would place a ring on every pawn and every objective
 * without anything being higher than anything. Equal bounds = old artifact without Z, or
 * plateau without relief; in both cases the floor language has nothing to say.
 */
export const FLAT_SPAN = 1e-6

/** The vertical bounds of the document, as `useReplayView` serves them. */
export interface FloorRange {
  min: number
  max: number
}

/**
 * floorInRange: the floor of a `z` (0 = ground) in the common language of pawns and objectives
 * — `floorOf` over the document span, and 0 on flat terrain (cf. `FLAT_SPAN`). Aligned on
 * 2026-09-18: the guard lived with the objectives alone, the pawns wrongly wore a ring on
 * every map without amplitude.
 */
export function floorInRange(z: number, range: FloorRange): number {
  if (!(range.max - range.min > FLAT_SPAN)) return 0
  return floorOf(z, range.min, range.max)
}

/** Radius of the FIRST ring of a pawn (board of 2026-08-16: detached from the point, not stuck). */
export const FLOOR_RING_RADIUS = 6.5
/** Step between two successive rings — the same for pawns and objectives. */
export const FLOOR_RING_GAP = 2.8
export const FLOOR_RING_WIDTH = 1
export const FLOOR_RING_ALPHA = 0.9
/** Each ring beyond the first pales by that much: the first stays the sharpest. */
export const FLOOR_RING_ALPHA_DECAY = 0.18

/**
 * floorRingRadius: radius (px, before scale factor) of ring n° `r` (1 = the first above the
 * ground), for a first ring placed at `first`.
 */
export function floorRingRadius(r: number, first: number = FLOOR_RING_RADIUS): number {
  return first + FLOOR_RING_GAP * (r - 1)
}

/** What varies from one caller to the other: the scale factor and the first radius. */
export interface FloorRingsGeometry {
  /** Scale factor of the marker (pawns carry one, objectives do not). */
  k?: number
  /** Radius of the first ring — cf. the header. */
  first?: number
}

/**
 * drawFloorRings traces `fl` concentric rings around `c`, in `color`, paling toward the
 * outside. `fl = 0` traces nothing. Leaves `globalAlpha` at 1 on exit.
 */
export function drawFloorRings(
  ctx: CanvasRenderingContext2D,
  c: XY,
  fl: number,
  color: string,
  geometry: FloorRingsGeometry = {},
): void {
  if (fl <= 0) return
  const k = geometry.k ?? 1
  const first = geometry.first ?? FLOOR_RING_RADIUS
  ctx.strokeStyle = color
  ctx.lineWidth = FLOOR_RING_WIDTH * k
  for (let r = 1; r <= fl; r++) {
    ctx.globalAlpha = FLOOR_RING_ALPHA - FLOOR_RING_ALPHA_DECAY * (r - 1)
    ctx.beginPath()
    ctx.arc(c.x, c.y, floorRingRadius(r, first) * k, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}
