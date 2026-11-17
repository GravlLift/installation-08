// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * placementWindow.ts — FROM WHEN TO WHEN a placement of equipment is on screen.
 *
 * EXTRACTED FROM `equipmentPlacementsLayer.ts` ON 2026-08-18 (batch R2-V), which already carried a debt
 * of size (503 lines) and was gaining the cap chain of the wall. The split falls on the only
 * question of this file: TIME. What remains to the overlay is the render decision and the
 * trace; what comes here is the window — and it is reasoned about without knowing a single
 * shape.
 *
 * The overlay RE-EXPORTS these three functions: they are part of its public surface (the hover
 * and the tests read them), and the internal split does not have to climb back up to its callers.
 */
import type { ReplayEquipmentPlacement } from '@/lib/api/types'

import type {
  PlacementHoverTime,
  PlacementKind,
  PlacementWindowTime,
} from '../layers/equipmentPlacementsLayer'
import { seekerImpulseActive } from '../layers/placementShapes'
import { SHROUD_DURATION_MS } from '../layers/placementShroud'
import { WALL_DURATION_MS } from '../layers/placementWall'
import { SENSOR_DURATION_MS } from './threatSensor'

/**
 * THE FALLBACK DURATIONS, per family: those that a placement WITHOUT READ END is applied. A family absent from
 * this table has no known duration: it stays displayed up to the end of the replay, lacking anything better.
 *
 * The values live in the file of THEIR family (`threatSensor.ts`, `placementWall.ts`,
 * `placementShapes.ts`), with their range and their geometry, and this table only gathers them for the
 * window. The sensor keeps the duration published by the editor; the wall and the shroud screen that which the film
 * measures (median of the barrier, duration of the bubble) — and the film, when it dates their end, outranks them.
 */
const OFFICIAL_DURATION_MS: Partial<Record<PlacementKind, number>> = {
  sensor: SENSOR_DURATION_MS,
  wall: WALL_DURATION_MS,
  shroud: SHROUD_DURATION_MS,
}

/**
 * A placement of which the END can be READ. `endRead` is only set on a placement fabricated from a
 * spawned object of which the film writes the removal (`spawnedObjects.ts`: sensor, repair field,
 * bubble of the shroud screen): its `t1` is then the end of the object, not the lower bound
 * of an unknown end. The placements OF THE DOCUMENT carry theirs in `lifeEnd` (the wall, schema 106).
 *
 * The type travels under that of the placements of the document (`ReplayEquipmentPlacement`): the arrays of the
 * overlay stay typed thus, and the flag is read at runtime, here and nowhere else.
 */
export type WindowedPlacement = ReplayEquipmentPlacement & { readonly endRead?: boolean }

/**
 * placementEndFrame — THE LAST FRAME at which a placement is drawn.
 *
 * `t1` IS NOT THE DISAPPEARANCE OF THE OBJECT, and that is measured, not assumed (2026-08-18,
 * `filmdec/equipment_life_end_test.go`): the decoder only follows the records that carry a
 * position, so that `t1` dates the instant at which the object stops MOVING. A protection wall there
 * reaches a median of 0.7 s and a sensor 2.1 s, while the census of keyframes shows
 * 101 of these 295 objects still present more than one second later. For the placements of the document, the
 * film dates NO disappearance of equipment — the removal record and the tail of records
 * without position are both noise there on the witness. `t1` is therefore a LOWER BOUND
 * (except for the placements with read end, first rule below).
 *
 * HENCE THE RULE, in three times and without inventing anything:
 *  - a placement with READ END stops at this end, which the fallback duration does not extend: the reading outranks any
 *    assumed duration. That is `endRead` (spawned object of which the film writes the removal: its `t1`) for
 *    a fabricated placement, `lifeEnd` (removal of the object that the placement created: the wall) for a placement of the document;
 *  - a family of which the duration is known keeps to it LACKING READ END — the threat sensor lasts
 *    15 s (editor), the wall 12.48 s (measured median), the screen 7.5 s (read in the film): cf.
 *    OFFICIAL_DURATION_MS;
 *  - the others stay displayed up to the end of the replay, lacking a duration to oppose them.
 *
 * THE WALL HAS JOINED THE SENSOR on 2026-08-20 (user request). It stayed up to the end
 * of the replay in the name of the principle « assert nothing that the measurement does not carry » — but letting a
 * wall on screen for eight minutes asserts something too, and a false one at that: the
 * official duration is the best information available, exactly as for the sensor.
 *
 * Never BEFORE `t1`: the measured bound outranks if it exceeds the official duration.
 */
export function placementEndFrame(
  p: WindowedPlacement,
  kind: PlacementKind,
  time: PlacementWindowTime,
): number {
  if (p.endRead) return p.t1
  const lastFrame = Math.max(time.frames - 1, p.t1)
  if (p.lifeEnd !== undefined) return Math.min(Math.max(p.lifeEnd, p.t0), lastFrame)
  const duration = OFFICIAL_DURATION_MS[kind]
  if (duration === undefined || !(time.frameMs > 0)) return lastFrame
  const official = p.t0 + Math.round(duration / time.frameMs)
  return Math.min(Math.max(official, p.t1), lastFrame)
}

/** isPlacementActive — is the placement drawn at this frame? (cf. placementEndFrame). */
export function isPlacementActive(
  p: WindowedPlacement,
  kind: PlacementKind,
  frame: number,
  time: PlacementWindowTime,
): boolean {
  return frame >= p.t0 && frame <= placementEndFrame(p, kind, time)
}

/**
 * placementShows — does the placement have something ON SCREEN at this frame?
 *
 * All the families show something over their whole display window (cf.
 * placementEndFrame), EXCEPT the seeker:
 * its impulse is unique and brief, and after it nothing remains. The hover follows the drawing —
 * one does not inspect what is not there, same rule as the toggle of the unidentified objects.
 */
export function placementShows(
  p: ReplayEquipmentPlacement,
  kind: PlacementKind,
  time: PlacementHoverTime,
): boolean {
  if (kind !== 'seeker') return true
  return seekerImpulseActive((time.frame - p.t0) * time.frameMs)
}
