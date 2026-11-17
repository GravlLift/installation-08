// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * spawnedObjects.ts — THE OBJECTS SPAWNED BY CARRIED EQUIPMENT, made drawable: the sensor, the
 * tracker, the shroud screen and the repair field, at the place where they came to rest.
 *
 * WHY A SEPARATE SOURCE. The placements layer only draws `equipmentPlacements` that are
 * `deployed`, and since the rule of 15/09/2026 (`origineDeLaPose`, on the Go side) only the wall
 * panels are: a carried device that falls is a drop, not a deployment. The sensor, the tracker,
 * the screen and the field were therefore no longer drawn at all, even though the document
 * carries their spawned object with its read life (`carriedEquipment[].tracked[]`) and — since
 * schema 105 — its REST POSITION (`land`, `x`, `y`, `z`, interdependent, read on the trajectory
 * of the same life).
 *
 * WHAT THIS MODULE DOES: for every SITUATED spawned object, build a placement that the layer,
 * the sensor reveal, the zone presence and the hover already know how to handle. A built
 * placement is a `deployed` placement of the family, at rest, in the carrier's name — and
 * nothing more. An unsituated object produces NOTHING: the position is not guessed (the carrier
 * is refuted by the measurement, the median flight spans 1.3 to 15 m).
 *
 * WHAT IT DOES NOT DO, AND THAT IS A REQUIREMENT (user, 2026-10-28):
 *  - THE WALL AND THE RIFT DO NOT GO THROUGH HERE. They are visible and sound today through
 *    their own channel (`equipmentPlacements` for the wall panels, `riftPoses` for the rift):
 *    their spawned objects also exist in `tracked`, and taking them up would draw them twice.
 *    The list of families is NAMED (`SPAWNED_OBJECT_FAMILIES`) and a test forbids finding there
 *    a family of `SPAWNED_OBJECT_OWN_CHANNEL_FAMILIES`.
 *  - THE SOUNDS NEVER READ THESE PLACEMENTS. `replaySound.ts` reads `doc.equipmentPlacements`,
 *    which this module does not modify; the four families already sound through
 *    `carriedEquipment[].uses`, a second sound would be a duplicate. Only
 *    `drawablePlacements` mixes the two sources, and it serves drawing, the reveal, the zones
 *    and the hover only.
 *
 * THE WINDOW OF EACH PLACEMENT (decision of 2026-10-28, measured on seven witness films):
 *  - sensor and repair field: from `land` to the READ `t1` (`endRead`) — the deletion of the
 *    object is written by the film, the official duration does not extend it. Without `t1`, the
 *    family's existing rule (15 s for the sensor, end of the replay for the field);
 *  - tracker: a single pulse anchored to `land` (the family's existing rule). Its `t1` is the end
 *    of the PROJECTILE (2 frames median), never that of the effect: it is not read;
 *  - shroud screen: its BUBBLE is a separate object (`tracked[].effect`, schema 106: the life the film creates on
 *    impact and deletes 7.5 s later). When it is read, the placement runs from `effect.t0` to `effect.t1`, at
 *    the bubble's position — and is drawn even when the grenade has no trajectory at all. Without a read bubble: anchored
 *    to `land`, end = 7.5 s later (`SHROUD_DURATION_MS`), the previous rule. The grenade's `t1` is the end of the
 *    projectile, never that of the effect.
 *
 * No React, no color, no canvas: pure document reading, tested on its own.
 */
import type { ReplayEquipmentPlacement } from '@/lib/api/types'

import { PLACEMENT_ORIGIN_DEPLOYED, placementIsDeployedObject } from '../layers/equipmentPlacementsLayer'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import type { WindowedPlacement } from './placementWindow'

/**
 * THE FOUR FAMILIES whose spawned object is drawn by this source. STABLE identifiers of the
 * document (`abilityLabels[rank].family`), never labels.
 */
export const SPAWNED_OBJECT_FAMILIES = [
  'sensor',
  'threat_seeker',
  'shroud_screen',
  'repair_field',
] as const

export type SpawnedObjectFamily = (typeof SPAWNED_OBJECT_FAMILIES)[number]

/**
 * THE FAMILIES THAT HAVE THEIR OWN CHANNEL AND THAT THIS SOURCE NEVER TAKES UP: the wall
 * (`deployed` placements of its panels) and the translocator beacon (`riftPoses`, drawn as a
 * rift).
 */
export const SPAWNED_OBJECT_OWN_CHANNEL_FAMILIES = ['wall', 'translocator_beacon'] as const

/** The families whose spawned object's `t1` is ITS deletion (and not the end of a projectile). */
const END_READ_FAMILIES: ReadonlySet<string> = new Set<SpawnedObjectFamily>(['sensor', 'repair_field'])

/** Identifier of a built placement: it carries no `eqip` tag, and does not pretend to have one. */
export const SPAWNED_OBJECT_ID = 'spawned'

type CarriedObject = ReplayDocumentReady['carriedEquipment'][number]
type Tracked = CarriedObject['tracked'][number]
/** What this module reads from the document. */
type SpawnedSource = Pick<ReplayDocumentReady, 'carriedEquipment' | 'abilityLabels'>

/** A spawned object whose rest position is read in full (the four fields are interdependent). */
type SituatedTracked = Tracked & { land: number; x: number; y: number; z: number }

function isSituated(t: Tracked): t is SituatedTracked {
  return (
    t.land !== undefined && t.x !== undefined && t.y !== undefined && t.z !== undefined
  )
}

/** The family of the carried object of this rank, if it is one of the four; null otherwise. */
function spawnedFamilyOf(
  labels: ReplayDocumentReady['abilityLabels'],
  rank: number,
): SpawnedObjectFamily | null {
  const family = labels?.[String(rank)]?.family
  return (SPAWNED_OBJECT_FAMILIES as readonly (string | undefined)[]).includes(family)
    ? (family as SpawnedObjectFamily)
    : null
}

/** Each spawned object of each carried object of one of the four families, in document order. */
function* spawnedObjects(
  doc: SpawnedSource,
): Generator<{ family: SpawnedObjectFamily; slot: number; tracked: Tracked }> {
  for (const carried of doc.carriedEquipment) {
    const family = spawnedFamilyOf(doc.abilityLabels, carried.r)
    if (family === null) continue
    for (const tracked of carried.tracked) yield { family, slot: carried.slot, tracked }
  }
}

/**
 * spawnedObjectPlacements — the built placements of the SITUATED spawned objects, in document
 * order. The owner is the carrier's slot, `t0` the rest frame, the position the rest position.
 * The `t1` equals the READ end (never before the rest) when the family carries it and the film
 * writes it; otherwise it equals `t0` and the placement does not say its end is read.
 */
export function spawnedObjectPlacements(doc: SpawnedSource): WindowedPlacement[] {
  const out: WindowedPlacement[] = []
  for (const { family, slot, tracked } of spawnedObjects(doc)) {
    const effect = family === SHROUD_FAMILY ? effectPlacement(slot, tracked) : null
    if (effect) {
      out.push(effect)
      continue
    }
    if (!isSituated(tracked)) continue
    const end = END_READ_FAMILIES.has(family) ? tracked.t1 : undefined
    out.push({
      family,
      id: SPAWNED_OBJECT_ID,
      origin: PLACEMENT_ORIGIN_DEPLOYED,
      owner: slot,
      t0: tracked.land,
      t1: end === undefined ? tracked.land : Math.max(end, tracked.land),
      x: tracked.x,
      y: tracked.y,
      z: tracked.z,
      ...(end === undefined ? {} : { endRead: true }),
    })
  }
  return out
}

/** The family whose bubble is a separate object: the shroud screen. */
const SHROUD_FAMILY: SpawnedObjectFamily = 'shroud_screen'

/**
 * The placement of the BUBBLE of a shroud screen, or null when the film gives none (or no place:
 * neither its position nor the grenade's rest). The position is that of the bubble; failing that,
 * the grenade's rest. Without a read end the placement keeps the family's fallback duration
 * (`SHROUD_DURATION_MS`), from the bubble's birth.
 */
function effectPlacement(slot: number, tracked: Tracked): WindowedPlacement | null {
  const effect = tracked.effect
  if (!effect) return null
  const at =
    effect.x !== undefined && effect.y !== undefined && effect.z !== undefined
      ? { x: effect.x, y: effect.y, z: effect.z }
      : isSituated(tracked)
        ? { x: tracked.x, y: tracked.y, z: tracked.z }
        : null
  if (at === null) return null
  return {
    family: SHROUD_FAMILY,
    id: SPAWNED_OBJECT_ID,
    origin: PLACEMENT_ORIGIN_DEPLOYED,
    owner: slot,
    t0: effect.t0,
    t1: effect.t1 === undefined ? effect.t0 : Math.max(effect.t1, effect.t0),
    ...at,
    ...(effect.t1 === undefined ? {} : { endRead: true }),
  }
}

/** The drawing arrays, computed once per document (the layer re-reads them on every frame). */
const DRAWABLE_BY_DOC = new WeakMap<object, readonly ReplayEquipmentPlacement[]>()

/**
 * drawablePlacements — EVERYTHING THE PLACEMENTS LAYER HAS TO DRAW: the document's placements
 * first, in their order, then the built placements. Without a situated spawned object, it is the
 * document's own array.
 *
 * ONLY the drawing, the sensor reveal, the zones and the hover read this array. The sounds keep
 * reading `doc.equipmentPlacements`, which this function never modifies.
 */
export function drawablePlacements(
  doc: Pick<ReplayDocumentReady, 'equipmentPlacements' | 'carriedEquipment' | 'abilityLabels'>,
): readonly ReplayEquipmentPlacement[] {
  const cached = DRAWABLE_BY_DOC.get(doc)
  if (cached) return cached
  const spawned = spawnedObjectPlacements(doc)
  const all = spawned.length === 0 ? doc.equipmentPlacements : [...doc.equipmentPlacements, ...spawned]
  DRAWABLE_BY_DOC.set(doc, all)
  return all
}

/** A counted deployment: the family, the carrier, and the frame where the object appears (the throw). */
export interface SpawnedDeployment {
  family: SpawnedObjectFamily
  owner: number
  t0: number
}

/**
 * spawnedObjectDeployments — ONE SPAWNED OBJECT = ONE DEPLOYMENT of its family, SITUATED OR NOT:
 * the gesture took place even when its place was not read. It is dated at the object's
 * appearance (the throw), where the carrier is beyond dispute the owner of the life.
 *
 * A FAMILY THE DOCUMENT'S PLACEMENTS ALREADY DEPLOY IS NOT RECOUNTED: artifacts prior to the rule
 * of 15/09/2026 still carry `deployed` placements for these devices, and counting them twice
 * would double the gesture.
 */
export function spawnedObjectDeployments(
  doc: Pick<ReplayDocumentReady, 'equipmentPlacements' | 'carriedEquipment' | 'abilityLabels'>,
): SpawnedDeployment[] {
  const countedElsewhere = new Set(
    doc.equipmentPlacements.filter(placementIsDeployedObject).map((p) => p.family),
  )
  const out: SpawnedDeployment[] = []
  for (const { family, slot, tracked } of spawnedObjects(doc)) {
    if (countedElsewhere.has(family)) continue
    out.push({ family, owner: slot, t0: tracked.t0 })
  }
  return out
}
