/**
 * dropWall3d_logic.ts — THE DROP WALL AT A FRAME: how far its barrier has risen, how far it has
 * dissolved, and where its panels stand.
 *
 * THE SOURCE is the document, through the placements gate the 2D uses (`placementSpans3d`): the
 * wall PANELS' placement (`equipmentPlacements`, origin `deployed`, a panel identifier), its frame
 * `t0`, its position, the aim of its planter (`wallHeading`) and its END: the read removal of the
 * panel's life (`lifeEnd`, schema 106) or, without it, the measured median duration of the barrier
 * (`placementEndFrame`). The barrier rises at `t0` and dissolves at that end.
 *
 * WHAT THE FILM DOES NOT SAY. It writes the removal, never its cause: a wall shot down and a wall
 * that timed out end the same way in the document, and the dissolve is the same for both. No
 * damage to the wall is recorded (the document's `damages` are players'), so the panels do not
 * crack one by one: they stand whole until the end, then go together.
 *
 * The geometry is the 2D arc (`placementWall`: radius and opening, the concave side toward the
 * planter), cut into flat panels, at the 2D's radius IN METERS (1.6 m, a 2.6 m chord calibrated on the
 * game's wall) converted to world units: drawn as 1.6 u it was a barrier 8 m wide standing 5 m beyond
 * the panel's position, over whatever floor lay there. The height is the 3D wall's on-screen height.
 * A function of the frame alone: seeking gives the same picture.
 */
import type { XY } from '@/lib/replay/replayLogic'

import { WALL_OPENING_RAD, WALL_RADIUS_M } from '../layers/placementWall'
import { metersToU } from './tracks3d'

/** The barrier's rise from the ground at deployment (ms). ESTIMATE; the true value is the deploy animation of the game's drop wall. */
export const WALL_RISE_MS = 250
/** The barrier's dissolve after its end (ms). ESTIMATE; the true value is the drop wall's destruction effect in the game. */
export const WALL_DISSOLVE_MS = 300
/** The flat panels the arc is cut into. ESTIMATE of the game's segmented barrier; the true count is its model, not in the app. */
export const WALL_PANEL_COUNT = 5
/** The arc's radius in world units: the 2D's `WALL_RADIUS_M`, a length in meters. */
export const WALL_RADIUS_U = metersToU(WALL_RADIUS_M)

/** The wall at one frame. */
export interface WallPhase {
  /** Part of its height the barrier has reached, in [0, 1]. */
  rise: number
  /** Part of the barrier gone after its end, in [0, 1[ ; 0 while it stands. */
  dissolve: number
}

/**
 * wallPhaseAt — the barrier at `frame`, or null before it is deployed and once it has dissolved.
 * `end` is its last frame standing (`placementEndFrame`).
 */
export function wallPhaseAt(t0: number, end: number, frame: number, frameMs: number): WallPhase | null {
  if (frame < t0 || !(frameMs > 0)) return null
  const dissolveFrames = WALL_DISSOLVE_MS / frameMs
  if (frame >= end + dissolveFrames) return null
  const rise = Math.min(1, (frame - t0) / (WALL_RISE_MS / frameMs))
  const dissolve = frame <= end ? 0 : (frame - end) / dissolveFrames
  return { rise, dissolve }
}

/** One flat panel of the barrier, in Halo world axes. */
export interface WallPanel {
  /** The middle of the panel's foot. */
  x: number
  y: number
  /** The direction the panel faces, outward from the planter (degrees, Halo convention). */
  headingDeg: number
  /** Its width (u): the chord of its share of the arc. */
  width: number
}

/**
 * wallPanels — the arc of the 2D wall around `center`, its middle at `headingDeg`, cut into
 * `WALL_PANEL_COUNT` flat panels standing on the chords: each faces away from the center.
 */
export function wallPanels(center: XY, headingDeg: number): WallPanel[] {
  const step = WALL_OPENING_RAD / WALL_PANEL_COUNT
  const first = (headingDeg * Math.PI) / 180 - WALL_OPENING_RAD / 2
  const offset = WALL_RADIUS_U * Math.cos(step / 2)
  const width = 2 * WALL_RADIUS_U * Math.sin(step / 2)
  const out: WallPanel[] = []
  for (let i = 0; i < WALL_PANEL_COUNT; i++) {
    const a = first + step * (i + 0.5)
    out.push({ x: center.x + offset * Math.cos(a), y: center.y + offset * Math.sin(a), headingDeg: (a * 180) / Math.PI, width })
  }
  return out
}
