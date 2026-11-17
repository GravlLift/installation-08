// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * equipmentPlacementsLayer.ts — EQUIPMENT PLACEMENTS on the map: what gets drawn, and above
 * all what does NOT get drawn.
 *
 * THE SOURCE is the document (schema 10): `equipmentPlacements`, one placement per object
 * life, with its [t0, t1] window on the frame axis, its world position, the FAMILY the
 * title manifest gives it (`replay_labels.toml`), the IDENTIFIER of the `eqip` tag, the SLOT
 * of its planter (`owner`, -1 if no contemporary biped within 3 m), the AIM CAP of that
 * planter (`h`, absent once in seven) and — since schema 10 — the MEASURED ORIGIN of the
 * placement.
 *
 * `equipmentPlacements` IS NOT WHAT ITS NAME SAYS, AND THE MEASUREMENT ESTABLISHED THAT
 * (phase G of 2026-08-18, 11 calibrated films, 3,661 placements with measured planter).
 * 88.6% of these placements are born within the 2 frames and the 1.5 m following the LAST
 * point of their planter: they are not objects placed on the map, they are the objects the
 * player CARRIED, released when they DIE. Hence the `origin === 'deployed'` filter: the
 * only origin that describes a gesture. The witness that validates the method is internal —
 * if the 88.6% were a window artifact, the WALL PANELS would carry it too; they have zero on
 * 48 and one on 43.
 *
 * SINCE 2026-08-19, A NARROW PART OF THESE DROPS IS STILL DRAWN, and that is a dated product
 * decision (user, 2026-08-18): power objects on the ground — power-ups and deployable
 * equipment — are visible, because they are pickable and they change the next exchange. The
 * list of what counts and the reason live in `placementDropped.ts`. The "no Fiesta"
 * restriction that accompanied this decision was lifted on 2026-08-20: the drawer setting
 * rules alone, in all modes.
 *
 * THE RENDER IS A TABLE BY FAMILY (`PLACEMENT_RENDER`), and that is the rule that counts: a
 * family absent from the table draws NOTHING, a family at `null` draws nothing EITHER but
 * decided so. Never the drawing of a neighbor, same principle as labels and sounds.
 *
 * THIS FILE DECIDES, IT BARELY TRACES ANYMORE. THE WALL (world geometry + panel identifiers)
 * lives in `placementWall.ts`; the shapes that fit in a projected center (beacon, seeker
 * pulse, field disk, neutral point, dropped object, reveal mark) live in
 * `placementShapes.ts` along with the framing base; the POINTER SENSITIVE ZONE lives in
 * `placementHitTest.ts`. What remains here is the SENSOR — its range is in meters and it is
 * the only one that reveals — and the dispatch.
 *
 * THE SENSOR PINGS, and everything it asserts — range, rate, reveal duration, revealed side —
 * lives in `threatSensor.ts`: the numbers there are OFFICIAL and sourced, the logic there is
 * pure and tested. This file keeps only the TRACE (disk, ring, wave).
 *
 * No React: pure geometry + a CanvasRenderingContext2D (same rule as replayDraw).
 */
import type { ReplayEquipmentPlacement } from '@/lib/api/types'

import { drawRift, type RiftInk } from './placementRift'
import { placementIsDroppedPower } from '../model/placementDropped'
import {
  drawDroppedObject,
  drawRepairField,
  drawRevealMark,
  drawSeekerImpulse,
  drawUnnamedDot,
  type PlacementView,
  project,
  REPAIR_FIELD_RADIUS_M,
  viewScale,
} from './placementShapes'
import { drawShroud, SHROUD_RADIUS_M, type ShroudInk } from './placementShroud'
import { drawWall, wallHeading, WALL_PANEL_IDS } from './placementWall'
// The WINDOW of a placement lives apart (cf. the re-export above): it is also READ here, and
// a re-export puts nothing in the local scope. The reverse import, for its part, carries only
// TYPES — so there is no cycle at execution.
import { isPlacementActive } from '../model/placementWindow'
import type { ReplayTrackReady } from '../../../lib/replay/replayNormalize'
import {
  SENSOR_FILL_ALPHA,
  SENSOR_PING_WIDTH,
  SENSOR_RADIUS_M,
  SENSOR_RING_ALPHA,
  SENSOR_RING_WIDTH,
  sensorPing,
  sensorReveals,
} from '../model/threatSensor'

/**
 * THE WINDOW OF A PLACEMENT lives in `placementWindow.ts` since 2026-08-18 (size threshold),
 * and is re-exported here: hover and the tests read it through this module, the internal
 * cut does not have to climb up to them.
 */
export { isPlacementActive, placementEndFrame, placementShows } from '../model/placementWindow'

/**
 * The framing is re-exported here: it is an ARGUMENT of this layer
 * (`drawEquipmentPlacementsLayer`, `placementAt`), so it belongs to its public surface —
 * its callers do not have to know the file where the internal cut put it.
 */
export type { PlacementView } from './placementShapes'

/**
 * The ways to draw a placement. These are NOT the families: the day two families share a
 * render (two walls of different palettes, for example), the table sends them both to the
 * same value without duplicating a trace.
 */
export type PlacementKind =
  | 'wall'
  | 'sensor'
  | 'rift'
  | 'shroud'
  | 'seeker'
  | 'field'
  | 'unnamed'
  /**
   * THE POWER OBJECT DROPPED ON THE GROUND. Rule ORTHOGONAL to the table: it does not come
   * from a family but from an ORIGIN (`dropped`) crossed with the list of
   * `placementDropped.ts`. One shape for all the families concerned — an object on the
   * ground does not act.
   */
  | 'dropped'

/** Family of the WALL — named because the rule of panels targets it explicitly. */
const PLACEMENT_FAMILY_WALL = 'wall'

/**
 * THE TABLE BY FAMILY — the single entry point of the render. The keys are the STABLE
 * identifiers published by the document (`family`, set by the title manifest), never labels.
 *
 * THREE STATES, AND THEIR DIFFERENCE IS MEANING, not code:
 *  - a RENDER RULE: the family draws, each with its shape;
 *  - `null`: the family is KNOWN and the decision is to draw nothing — see the carried
 *    objects below;
 *  - ABSENT: nothing was decided, and the layer stays silent. That is the case of the
 *    families a future manifest would add, and of the — accepted — power-ups (see the note
 *    at the end of the table).
 *
 * IT IS ENUMERATED ELSEWHERE, and a guard checks it: `equipmentFamilies` of the Go
 * validator (`internal/games/mappings/loader_replay_labels_equipment.go`) and
 * `placementFamily` of the i18n must agree with it — cf.
 * `placementFamily.guard.test.ts`, which READS the Go file.
 */
export const PLACEMENT_RENDER: Readonly<Record<string, PlacementKind | null>> = {
  // The objects the measurement sees DEPLOYED, each with its own shape.
  wall: 'wall',
  sensor: 'sensor',
  // THE FAMILY KEEPS ITS NAME `translocator_beacon` — it is a STABLE identifier of the
  // document, and thousands of already-cooked artifacts carry it; renaming it would be a
  // contract break, not a label correction. What changes is what the layer DRAWS of it and
  // what it SAYS of it: a rift, not a beacon (user correction, 2026-08-27).
  translocator_beacon: 'rift',
  // THE BLACKOUT SCREEN: named 2026-08-27 by its sound bank, drawn the same day after the
  // user verdict on the three proposals of the board — "opaque with dots above". Naming,
  // sounding and drawing were three distinct works, in that order.
  shroud_screen: 'shroud',
  threat_seeker: 'seeker',
  repair_field: 'field',
  // The placed object whose nature is not established: a neutral point, and only on toggle.
  other: 'unnamed',
  // THE OBJECTS THE PLAYER CARRIES — `null` EXPLICIT, AND THAT IS A MEASURED DECISION.
  //
  // The four grenades make 59 to 63% of the corpus placements, and 95% of them are DROPS AT
  // DEATH (`dropped`). The few `deployed` that remain are thrown grenades — and throws
  // already have their layer, with their trajectory and their type. The grapple, the
  // thruster and the repulsor are capabilities that act ON THEIR CARRIER: what the film
  // publishes here is the device itself, not an object placed on the field (the grapple
  // moreover has its own traction layer). Drawing them would drown the wall and the sensor
  // under points that say nothing of the field.
  grenade_frag: null,
  grenade_plasma: null,
  grenade_dynamo: null,
  grenade_spike: null,
  grapple: null,
  thruster: null,
  repulsor: null,
  // POWER-UPS (`powerup_overshield`, `powerup_camo`): DELIBERATELY ABSENT, NOT EVEN AT
  // `null`.
  //
  // The plan intended to draw them as objects of the MAP, without planter, at their pad.
  // THE MEASUREMENT REFUTED THE HYPOTHESIS ON THE LITTLE WE HAD: the whole corpus (11
  // films) carries ONE overshield placement and ONE camo placement, and the TWO have a
  // planter and are `dropped` (23 and 38 ms, 0.53 and 0.67 m from the end of life of their
  // planter). No recurrent position could be searched. Coding a rule that no measured
  // member falls under would be dead vocabulary (CLAUDE.md #7).
  //
  // THE PAD EXISTS SINCE 2026-08-19 (schema 17) AND CHANGES NOTHING HERE — read before
  // "correcting" this absence. The `ti=37` lane does publish a real pad power-up, but in
  // `weaponPads`, the other channel of the document, and the PAD layer draws it (large,
  // named, with its HUD vignette). Letting them into this table would draw a SECOND mark
  // in the same place.
  //
  // THEIR DROP, HOWEVER, IS DRAWN SINCE 2026-08-19 — and not by this table. The product
  // decision of 2026-08-18 ("draw the objects dropped at death") goes through an ORIGIN
  // rule, `placementDropped.ts`, which does not ask any family to have an active object
  // shape. This table remains what it has always been: what draws when the object is
  // DEPLOYED. Power-ups do not have one, and will not have one.
}

/**
 * THE ORIGIN THAT DRAWS. STABLE identifier of the document, never a label.
 *
 * The published vocabulary is `deployed` / `dropped` / `unknown` — `spawn` does not exist:
 * the criterion "grant received at spawn" that the plan wrote before the measurement counts
 * 4 placements on 3,661 (0.1%), and the four are lives of 0.13 s and 1.49 s where start and
 * end coincide.
 */
export const PLACEMENT_ORIGIN_DEPLOYED = 'deployed'

/** Origin not established: no measured planter, or artifact earlier than schema 10. */
export const PLACEMENT_ORIGIN_UNKNOWN = 'unknown'

/**
 * placementOrigin — the origin of a placement, as we are allowed to read it.
 *
 * THE FIELD IS OPTIONAL IN THE CONTRACT, AND ITS ABSENCE READS `unknown` — NEVER
 * `deployed`. Artifacts earlier than schema 10 are still on disk and in production until
 * the full re-cook: a fallback on `deployed` would draw, across that whole fleet, exactly
 * the ghost wall this filter exists to remove.
 */
export function placementOrigin(p: ReplayEquipmentPlacement): string {
  return p.origin ?? PLACEMENT_ORIGIN_UNKNOWN
}

/**
 * placementIsDeployedObject — is this placement the DEPLOYED object we are allowed to show?
 *
 * TWO CONDITIONS, BOTH MEASURED: the origin is a deployment, and — for the wall only — the
 * identifier is that of the PANELS (cf. WALL_PANEL_IDS: a deployed wall produces two
 * placements, the flying device and its panels, and drawing both would make two arcs for
 * one wall).
 *
 * EXPORTED BECAUSE THE SOUND READS THE SAME RULE (`replaySound.ts`): the placement gesture
 * that sounds is the same as the one that draws. Two predicates would diverge at the first
 * change.
 */
export function placementIsDeployedObject(p: ReplayEquipmentPlacement): boolean {
  if (placementOrigin(p) !== PLACEMENT_ORIGIN_DEPLOYED) return false
  if (p.family !== PLACEMENT_FAMILY_WALL) return true
  return WALL_PANEL_IDS.includes(p.id)
}

/**
 * What the layer needs to know of the current instant. `frameMs` is the REAL duration of a
 * frame (cf. `frameToMs(1, doc)`): it is what gives its age to the pulse, never a frame
 * counter — the sampling rate is chosen at build.
 */
export interface PlacementTime extends PlacementToggles {
  frame: number
  frameMs: number
  /** Total number of frames of the replay (`doc.frameCount`): the bound of placements with
   * no known end. */
  frames: number
  /** Pixel density: the screen thicknesses follow it (same rule as the markers). */
  k: number
  reducedMotion: boolean
}

/**
 * THE TWO TOGGLES THE RENDER DEPENDS ON, and they travel together because they answer the
 * same question: what is allowed to appear in addition to the deployed objects?
 *
 * `showDropped` is the SETTING, and nothing more. A mode guard crossed it until 2026-08-20
 * to cancel it in Fiesta; it was removed (user request: these drops are real, and he wants
 * to see them). This module has never known any mode, and still knows none — the replay
 * document does not publish any.
 */
export interface PlacementToggles {
  /** Do unidentified objects draw? Drawer toggle, OFF by default. */
  showUnnamed: boolean
  /** Do DROPPED power objects draw? Drawer toggle, ON by default. */
  showDropped: boolean
}

/** What needs to be known of time to bound a placement — nothing more (5-parameter rule). */
export type PlacementWindowTime = Pick<PlacementTime, 'frameMs' | 'frames'>

/** What the HOVER needs to know of the instant: the frame, its window, and the toggles. */
export type PlacementHoverTime = Pick<PlacementTime, 'frame' | 'frameMs' | 'frames'> &
  PlacementToggles

/**
 * What the layer needs to READ: the placements, and — for the threat sensor only — the
 * lives and their sides.
 *
 * WHY THE THREE TRAVEL TOGETHER. The sensor does not draw alone: its ping REVEALS
 * opponents, and "opponent" is a relation between two lives. Grouping them keeps
 * `drawEquipmentPlacementsLayer` at five parameters (CLAUDE.md #5 threshold) and says what
 * they are: a SCENE, not three independent arguments.
 */
export interface PlacementScene {
  placements: readonly ReplayEquipmentPlacement[]
  /** All the lives of the film; the reveal scan filters itself on their window. */
  lives: readonly ReplayTrackReady[]
  /**
   * Side of the life that occupies a slot AT A FRAME (its team from the FILM); null =
   * unknown side, so never revealed nor revealing. The frame lifts the ambiguity of a slot
   * reattributed between rounds (planter read at its placement, target at the ping — cf.
   * threatSensor).
   */
  campOfSlot: (slot: number, frame: number) => number | null
}

/** Inks of the layer: the team color of the planter, and the neutral when there is none. */
export interface PlacementInk {
  /**
   * Color of the planter, resolved by slot AND by frame, asked at the instant of the
   * PLACEMENT (`p.t0`) — not at the current frame, where the slot can belong to another
   * player (next round). MUST be a BOUNDARY resolver (`colorOfSlotOrLast`): the dominant
   * class of placements is the object DROPPED at death, whose `t0 = deathEnd + 1` — the
   * planter no longer covers the frame, and a strict resolver would return `null` →
   * neutral ink instead of the color of the dropper. `null` = neither covering life nor
   * previous life: falls back to `neutral`.
   */
  colorOfSlot: (slot: number, frame: number) => string | null
  /**
   * FIXED ink of the wall arc (token `warning`, verdict R2-5 of 2026-08-18). It does NOT
   * go through `inkOf`: the wall is the only placed object whose color says what it IS
   * rather than who placed it — the user explicitly accepted to lose the side on that one.
   */
  wall: string
  /**
   * FIXED inks of the translocator rift (2026-08-27). Like `wall`, they do NOT go through
   * `inkOf`: the user wants the rift to read as an "interdimensional portal", and a team
   * tint would make it read as a side marker.
   */
  rift: RiftInk
  /**
   * FIXED inks of the blackout screen (2026-10-30): night blue and electric blue. Like the
   * rift, they say what the object IS, not who placed it — they do not go through `inkOf`.
   */
  shroud: ShroudInk
  /** Neutral ink of the theme (`--muted-foreground`), served to placements without planter. */
  neutral: string
}

/**
 * placementKind renders the render rule of a placement, or null when there is none.
 *
 * THREE GATES, IN THIS ORDER, AND THE ORDER IS THE RULE:
 *  1. THE UNIDENTIFIED OBJECT passes first and ESCAPES the origin filter — its toggle is a
 *     diagnostic tool ("an equipment object is here, its nature is not established"), and
 *     for that service the origin adds nothing: we want to see what we cannot name, from
 *     wherever it comes. Off by default, behavior unchanged;
 *  2. THE DROPPED POWER OBJECT next, because it does NOT depend on the table: a power-up
 *     does not figure in it at all, and a dropped wall figures in it without falling under
 *     it (its identifier is that of the device, not the panels). Testing it after the
 *     table would lose it;
 *  3. THE DEPLOYMENT at last — the origin rule, unchanged since schema 10.
 *
 * What passes none of the three draws nothing: family off-table, family at `null`
 * (grenades and capabilities), drop of a family that is not power.
 */
export function placementKind(
  p: ReplayEquipmentPlacement,
  toggles: PlacementToggles,
): PlacementKind | null {
  const kind = PLACEMENT_RENDER[p.family]
  if (kind === 'unnamed') return toggles.showUnnamed ? kind : null
  if (toggles.showDropped && placementIsDroppedPower(p)) return 'dropped'
  if (!kind) return null
  return placementIsDeployedObject(p) ? kind : null
}

/** inkOf — the team color of the planter, or the neutral when the placement has no known
 * planter. */
function inkOf(p: ReplayEquipmentPlacement, ink: PlacementInk): string {
  if (p.owner < 0) return ink.neutral
  // AT THE INSTANT OF THE PLACEMENT (`p.t0`). WARNING: for the DOMINANT class — objects
  // DROPPED at death — `t0 = deathEnd + 1`, the planter does NOT occupy the slot ANYMORE.
  // `colorOfSlot` must therefore be a BOUNDARY resolver (`ownerAtFrameOrLast`, wired by
  // the caller): it falls back to the life that just ended — the dropper — instead of
  // returning `null` (neutral ink). For a DEPLOYED object, `t0` falls in the life of the
  // planter and the boundary returns the same thing as strict.
  return ink.colorOfSlot(p.owner, p.t0) ?? ink.neutral
}

/**
 * drawSensor — the ZONE of the sensor (very low alpha disk, bounded by its ring) and, when
 * a wave is in progress, THE PING: a ring that starts from the center and opens out to the
 * radius while fading.
 *
 * THE ZONE NO LONGER MOVES, only the wave moves: that is what distinguishes a sensor that
 * PINGS from a sensor that breathes. The disk says the official range, permanently; the
 * wave says the instant.
 *
 * `ctx.arc` on the PROJECTED center and the scaled radius: the replay projection is a
 * similarity (same factor in X and in Y, cf. worldToCanvas), so a world circle stays a
 * screen circle. What gets computed in world is what carries an ORIENTATION — the wall.
 */
function drawSensor(
  ctx: CanvasRenderingContext2D,
  p: ReplayEquipmentPlacement,
  view: PlacementView,
  time: PlacementTime,
  color: string,
): void {
  const c = project({ x: p.x, y: p.y }, view)
  const r = SENSOR_RADIUS_M * viewScale(view)
  if (!(r > 0)) return
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.globalAlpha = SENSOR_FILL_ALPHA
  ctx.beginPath()
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = SENSOR_RING_ALPHA
  ctx.lineWidth = SENSOR_RING_WIDTH * time.k
  ctx.beginPath()
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
  ctx.stroke()
  const wave = sensorPing((time.frame - p.t0) * time.frameMs, time.reducedMotion)
  if (wave && wave.reach > 0) {
    ctx.globalAlpha = wave.alpha
    ctx.lineWidth = SENSOR_PING_WIDTH * time.k
    ctx.beginPath()
    ctx.arc(c.x, c.y, r * wave.reach, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * What is needed to trace ONE placement: the placement, its already-decided render rule,
 * and THE LIVES.
 *
 * THE LIVES ARE THERE FOR THE WALL ONLY, and that is accepted: since 2026-08-18, a wall
 * without an aim cap borrows the TRAJECTORY of its planter (cf. `wallHeading`). Grouping
 * them in an object rather than adding two parameters keeps `drawPlacement` under the
 * threshold of the five-parameter rule (CLAUDE.md #5) and avoids recomputing
 * `placementKind`, which the caller already knows.
 */
interface PlacementTarget {
  p: ReplayEquipmentPlacement
  kind: PlacementKind
  lives: readonly ReplayTrackReady[]
}

/**
 * drawPlacement — the shape of ONE placement, dispatched by its render rule.
 *
 * The wall and the sensor receive the placement and the framing: they work in WORLD. The
 * others receive an already-projected center — that is the boundary of
 * `placementShapes.ts`.
 */
function drawPlacement(
  ctx: CanvasRenderingContext2D,
  target: PlacementTarget,
  view: PlacementView,
  time: PlacementTime,
  ink: PlacementInk,
): void {
  const { p, kind } = target
  const color = inkOf(p, ink)
  if (kind === 'wall') {
    drawWall(ctx, { p, heading: wallHeading(p, target.lives) }, view, time, ink.wall)
    return
  }
  if (kind === 'sensor') {
    drawSensor(ctx, p, view, time, color)
    return
  }
  const c = project({ x: p.x, y: p.y }, view)
  const ageMs = (time.frame - p.t0) * time.frameMs
  // The two disks whose range is in METERS share the same scale: reading it once avoids
  // their diverging the day the framing would change source.
  const pxParM = viewScale(view)
  if (kind === 'dropped') drawDroppedObject(ctx, c, time, color)
  else if (kind === 'rift') drawRift(ctx, c, time, ink.rift)
  else if (kind === 'shroud') drawShroud(ctx, { c, radiusPx: SHROUD_RADIUS_M * pxParM, ageMs }, time, ink.shroud)
  else if (kind === 'seeker') drawSeekerImpulse(ctx, c, ageMs, time, color)
  else if (kind === 'field')
    drawRepairField(ctx, { c, radiusPx: REPAIR_FIELD_RADIUS_M * pxParM, ageMs }, time, color)
  else drawUnnamedDot(ctx, c, time, color)
}

/**
 * drawEquipmentPlacementsLayer traces the ACTIVE placements at the current frame, then the
 * reveal marks that the sensor pings produce at this instant.
 *
 * The drawn window is that of `placementEndFrame`: a placement with read end (`endRead`,
 * sensor and generated field) goes from its placement to that end; otherwise `t1` is only
 * a lower bound and the family holds to its official duration when it has one (sensor,
 * wall), or stays until the end of the replay.
 *
 * THE MARKS PASS AFTER ALL THE PLACEMENTS, and never in the loop: a mark is a sign placed
 * on a PLAYER, it must read on top of the zones — including that of a second sensor that
 * would cover the first.
 */
export function drawEquipmentPlacementsLayer(
  ctx: CanvasRenderingContext2D,
  scene: PlacementScene,
  view: PlacementView,
  time: PlacementTime,
  ink: PlacementInk,
): void {
  const sensors: ReplayEquipmentPlacement[] = []
  for (const p of scene.placements) {
    const kind = placementKind(p, time)
    if (!kind || !isPlacementActive(p, kind, time.frame, time)) continue
    drawPlacement(ctx, { p, kind, lives: scene.lives }, view, time, ink)
    if (kind === 'sensor') sensors.push(p)
  }
  if (sensors.length === 0) return
  for (const reveal of sensorReveals(sensors, scene, time)) {
    // The mark carries the color of the PLANTER, resolved at the frame of its placement
    // (`reveal.ownerFrame`): the slot of the planter can belong to another player at the
    // current frame (next round).
    const color = ink.colorOfSlot(reveal.owner, reveal.ownerFrame) ?? ink.neutral
    drawRevealMark(ctx, project({ x: reveal.x, y: reveal.y }, view), reveal.sinceMs, time, color)
  }
}

/**
 * countDrawablePlacements — what a document gives TO DRAW, counted by the SAME GATE as the
 * tracing (`placementKind`).
 *
 * WHY HERE AND NOT IN THE COMPONENT. An interface toggle must only light up if something
 * would draw behind it (same rule as the Zones button), and "something would draw" is a
 * decision of THIS module — family off-table, carried object, drop of a family with no
 * stake. Recounting it in the component would be two possible answers to the same
 * question. THE TOGGLES ALL COUNT AS `true`: we count what WOULD draw if the reader lit
 * them, otherwise the command that lights them would never show.
 *
 * `dropped` IS A SUBSET of `drawable`, like `unnamed`: they are three views of the same
 * scan, not three disjoint populations.
 */
export function countDrawablePlacements(placements: readonly ReplayEquipmentPlacement[]): {
  drawable: number
  unnamed: number
  dropped: number
} {
  const toggles: PlacementToggles = { showUnnamed: true, showDropped: true }
  let drawable = 0
  let unnamed = 0
  let dropped = 0
  for (const p of placements) {
    const kind = placementKind(p, toggles)
    if (!kind) continue
    drawable++
    if (kind === 'unnamed') unnamed++
    if (kind === 'dropped') dropped++
  }
  return { drawable, unnamed, dropped }
}
