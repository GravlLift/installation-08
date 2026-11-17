// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * equipmentZones.ts — THE PLAYER IN AN EQUIPMENT ZONE: what the card is allowed
 * to assert when a player stands in the disk of a placed object.
 *
 * THE SOURCE is the same as that of the map layer: `equipmentPlacements` (schema 10),
 * filtered by the SAME gates — `placementKind` (deployed family, never a dropped object) and
 * `isPlacementActive` (display window, official sensor duration included). The card
 * therefore never says anything other than what the map draws: if the disk is on screen and
 * the player is inside it, the card carries it; if the layer does not draw the placement, the card
 * stays silent. Two divergent answers to « does this zone exist? » would be a defect.
 *
 * THREE ZONES, AND ONLY THREE — those whose object EXERCISES a surface effect:
 *  - the REPAIR FIELD (declared radius, cf. placementShapes.REPAIR_FIELD_RADIUS_M) and
 *    the SHROUD SCREEN (declared radius, SHROUD_RADIUS_M) apply to EVERYONE: the dome
 *    of the game heals whoever stands in it, the bubble hides in both directions. No camp enters
 *    the rule, and that is faithful to the game, not a simplification;
 *  - the THREAT SENSOR concerns only the ADVERSARIES of the placer, and the camp rule is
 *    EXACTLY the one of `sensorReveals` (threatSensor.ts): the team of the FILM on both sides,
 *    and without a known camp — placer not measured, life whose team the film keeps silent — NOTHING is
 *    asserted. The card states the STATE here (« it stands in the zone of an enemy sensor »),
 *    in the present and continuously; the REVEAL marker of the map, for its part, keeps its own
 *    rule (membership measured at the instant of the ping) — two distinct assertions, both
 *    true. `sincePingMs` is published so that the display can beat at the
 *    official cadence of the sensor instead of inventing a rhythm.
 *
 * No React, no canvas: pure logic, tested (equipmentZones.test.ts).
 */
import type { ReplayEquipmentPlacement } from '@/lib/api/types'

import {
  isPlacementActive,
  placementKind,
  type PlacementKind,
  type PlacementToggles,
  type PlacementWindowTime,
} from '../layers/equipmentPlacementsLayer'
import { REPAIR_FIELD_RADIUS_M } from '../layers/placementShapes'
import { SHROUD_RADIUS_M } from '../layers/placementShroud'
import { SENSOR_RADIUS_M, sensorPingAgeMs } from './threatSensor'

/** What the card needs to READ: the placements, and the camp of the life that occupies a slot AT ONE
 *  FRAME (same contract as `PlacementScene.campOfSlot` — null = unknown camp, therefore never an
 *  enemy; the frame lifts the ambiguity of a slot reattributed between rounds). */
export interface ZoneScene {
  placements: readonly ReplayEquipmentPlacement[]
  campOfSlot: (slot: number, frame: number) => number | null
}

/** The queried player: its life (slot), its WORLD position at the frame, and the frame. */
export interface ZoneQuery {
  slot: number
  x: number
  y: number
  frame: number
}

/** What the card must say at a frame: each zone, independently. */
export interface ZonePresence {
  repair: boolean
  /**
   * ms since the PLACEMENT of the shroud screen covering the player — the most recent when
   * several overlap (same rule as the sensor: two overlapping clocks would
   * say nothing more). This is the clock of the FLASHES of the card (negative delay,
   * cf. ReplayTeams.ZoneFxOverlay): the flicker resumes at its actual progress
   * after a playback jump, never on an invented rhythm. Null = outside any screen.
   */
  shroudSinceMs: number | null
  /**
   * ms since the last ping of the ENEMY sensor covering the player — the most recently
   * pinged when several overlap (same rule as the reveal marker: two
   * overlapping clocks would say nothing more). Null = outside any enemy zone.
   */
  sensorSincePingMs: number | null
}

/** No allocation per frame: the « outside any zone » value is shared. */
export const NO_ZONES: ZonePresence = Object.freeze({
  repair: false,
  shroudSinceMs: null,
  sensorSincePingMs: null,
})

/**
 * THE DRAWER TOGGLES DO NOT ENTER HERE, and that is a stated choice: they govern what
 * the MAP displays IN ADDITION to the deployed objects (unidentified objects, drops). The three
 * zones are all deployed families, which these toggles do not touch — the state of a
 * player does not depend on a display setting.
 */
const NO_TOGGLES: PlacementToggles = { showUnnamed: false, showDropped: false }

/**
 * Radius of EACH zone, in world meters — the SAME constants as the drawing of the map, and
 * each keeps the status that its source file writes to it: official for the sensor,
 * declared (screen choice) for the field and the screen. A render rule absent from this
 * table is not a zone: the wall is an arc, not a disk, and a dropped object does not act.
 */
const ZONE_RADIUS_M: Partial<Record<PlacementKind, number>> = {
  field: REPAIR_FIELD_RADIUS_M,
  shroud: SHROUD_RADIUS_M,
  sensor: SENSOR_RADIUS_M,
}

/**
 * zonePresenceAt says in which zones a player stands at a frame.
 *
 * The sweep is linear over the placements (tens per film) with two O(1) exits up front
 * (family without zone, closed window): negligible next to the render, even called per card and
 * per frame (eight cards on the worst corpus).
 */
export function zonePresenceAt(
  scene: ZoneScene,
  query: ZoneQuery,
  time: PlacementWindowTime,
): ZonePresence {
  let repair = false
  let shroudSinceMs: number | null = null
  let sensorSincePingMs: number | null = null
  // The queried player is alive at the frame (the card resolved it from its current life): its
  // camp is therefore read at `query.frame`, never frozen for the whole match.
  const side = scene.campOfSlot(query.slot, query.frame)
  for (const p of scene.placements) {
    const kind = placementKind(p, NO_TOGGLES)
    if (!kind) continue
    const radius = ZONE_RADIUS_M[kind]
    if (radius === undefined) continue
    if (!isPlacementActive(p, kind, query.frame, time)) continue
    const dx = query.x - p.x
    const dy = query.y - p.y
    if (dx * dx + dy * dy > radius * radius) continue
    if (kind === 'field') repair = true
    else if (kind === 'shroud') {
      // THE AGE OF THE PLACEMENT, not a boolean: the flashes of the card align on it.
      const since = (query.frame - p.t0) * time.frameMs
      if (shroudSinceMs === null || since < shroudSinceMs) shroudSinceMs = since
    } else {
      // SENSOR: enemy only, both camps KNOWN — the rule of sensorReveals,
      // identically. Without a measured placer or without a camp, the disk is drawn but the card
      // asserts no hostility.
      if (p.owner < 0 || side === null) continue
      // The placer is read at the instant of its PLACEMENT (`p.t0`), where it was alive on this slot.
      const owner = scene.campOfSlot(p.owner, p.t0)
      if (owner === null || owner === side) continue
      const since = sensorPingAgeMs((query.frame - p.t0) * time.frameMs)
      if (sensorSincePingMs === null || since < sensorSincePingMs) sensorSincePingMs = since
    }
  }
  if (!repair && shroudSinceMs === null && sensorSincePingMs === null) return NO_ZONES
  return { repair, shroudSinceMs, sensorSincePingMs }
}
