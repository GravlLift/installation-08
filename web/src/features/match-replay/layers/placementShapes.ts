// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * placementShapes.ts — THE BASE OF THE TRACING of equipment placements, and the SHAPES that
 * fit in a PROJECTED CENTER.
 *
 * THE BOUNDARY IS GEOMETRIC, NOT THEMATIC, and that is what makes it holdable: this file
 * carries the framing (`PlacementView`, `project`, `viewScale`), the stroke primitives, and
 * the shapes that only need an already-projected point (for the disk, an already-converted
 * radius in pixels). The WALL lives apart (`placementWall.ts`) because it is computed in
 * WORLD — it carries an orientation, and an orientation only makes sense before the
 * projection.
 *
 * WHY THIS FILE EXISTS: the layer was reaching its size threshold (CLAUDE.md #5) and this
 * lot adds three families to it. Rather than an exemption, the cut — and it falls on a line
 * that is said in one sentence.
 *
 * WHAT EACH SHAPE ASSERTS, AND WHAT IT DOES NOT ASSERT. None of these shapes carries an
 * orientation: the film publishes none for these objects (the only measured cap is that of
 * the REGARD of the planter, and it is only exploited by the arc of the wall). The diamond
 * of the beacon is symmetric by construction — it points nowhere, and that is deliberate.
 *
 * No React, no written color: pure geometry + a CanvasRenderingContext2D. The ink comes from
 * the calling layer, which holds it from the theme tokens.
 */
import type { ReplayBounds } from '@/lib/api/types'

import { type XY } from '../../../lib/replay/replayLogic'
import {
  REVEAL_FILL_ALPHA,
  REVEAL_RADIUS_PX,
  REVEAL_WIDTH,
  revealAlpha,
  SENSOR_PING_ALPHA,
  SENSOR_SWEEP_MS,
} from '../model/threatSensor'
import { projectTo, scaleOf } from '../model/replayView'

/** Canvas framing (same parameters as worldToCanvas). */
export interface PlacementView {
  bounds: ReplayBounds
  width: number
  height: number
  pad: number
}

/** project — a world point to the pixels of the canvas (the chain of the tracks). */
export function project(p: XY, view: PlacementView): XY {
  return projectTo(view, p)
}

/** viewScale — the pixels-per-meter factor of the current framing (0 if the framing is
 * degenerate). */
export function viewScale(view: PlacementView): number {
  return scaleOf(view)
}

/**
 * What every shape needs to know of the SCREEN: the pixel density (the thicknesses follow
 * it, same rule as the markers) and the respect of reduced motion.
 *
 * `PlacementTime` of the layer is a superset of it: it is passed as is.
 */
export interface ShapeStyle {
  k: number
  reducedMotion: boolean
}

/**
 * THE DOTTED LINE OF UNCERTAINTY — a grammar, not a decoration.
 *
 * The layer already uses it for the wall WITHOUT CAP ("here, a wall", without saying in
 * which direction); the repair field uses it for its BOUND (a declared radius, not
 * measured). In both cases the message is the same: this limit is not asserted. A full
 * stroke, in this layer, always says a value we hold from a source (the ring of the sensor:
 * official range).
 */
export const UNCERTAIN_DASH: readonly number[] = [3, 3]

/** strokePolyline traces a sequence of ALREADY PROJECTED points (open arc, circle, diamond). */
export function strokePolyline(ctx: CanvasRenderingContext2D, pts: XY[], closed: boolean): void {
  if (pts.length === 0) return
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y)
  if (closed) ctx.closePath()
  ctx.stroke()
}

// --- UNIDENTIFIED OBJECT ------------------------------------------------------------------

/** Radius of the neutral point of unidentified objects, in screen pixels. */
export const UNNAMED_DOT_RADIUS_PX = 2.5

const UNNAMED_ALPHA = 0.5

/**
 * drawUnnamedDot — the neutral point of an object whose nature is not established. No shape
 * borrowed from the named families: this marker says "an equipment object is here", and it
 * has no right to say more.
 */
export function drawUnnamedDot(
  ctx: CanvasRenderingContext2D,
  c: XY,
  style: ShapeStyle,
  color: string,
): void {
  ctx.save()
  ctx.globalAlpha = UNNAMED_ALPHA
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(c.x, c.y, UNNAMED_DOT_RADIUS_PX * style.k, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// --- OBJECT DROPPED ON THE GROUND -------------------------------------------------------------------

/** Radius of the ring of a dropped object, in screen pixels. */
export const DROPPED_RADIUS_PX = 4.5

/**
 * THE FAINTNESS OF AN OBJECT ON THE GROUND. It is lower than that of the unidentified point
 * (0.5): a drop is a certain but SECONDARY fact, and it must never take precedence over the
 * wall or the sensor deployed in the same place.
 */
const DROPPED_ALPHA = 0.42

/** Thickness of the rim, at the density of the screen (same rule as the other strokes of
 * the layer). */
const DROPPED_LINE_WIDTH = 1.25

/**
 * drawDroppedObject — the power object dropped on the ground: a DOTTED ring, faint, empty.
 *
 * THREE CHOICES, AND EACH SAYS THE SAME THING — the object is there, it does not act.
 *  - DOTTED: it is the grammar of the layer (cf. UNCERTAIN_DASH), used here for what it
 *    already knows how to say — the limit is not asserted, the object exercises no range;
 *  - EMPTY (no fill): the full shapes of this layer say an EFFECT ZONE (disk of the sensor,
 *    repair field). An object on the ground has none;
 *  - ONE SINGLE SHAPE for all the families: taking back the arc of the wall or the disk of
 *    the sensor would assert a deployment that did not take place — the measurement says the
 *    opposite (a dropped wall carries the identifier of the DEVICE, never that of the
 *    panels).
 *
 * The family, for its part, is read at the hover: it is the tooltip that names, never the
 * shape.
 */
export function drawDroppedObject(
  ctx: CanvasRenderingContext2D,
  c: XY,
  style: ShapeStyle,
  color: string,
): void {
  const r = DROPPED_RADIUS_PX * style.k
  if (!(r > 0)) return
  ctx.save()
  ctx.globalAlpha = DROPPED_ALPHA
  ctx.strokeStyle = color
  ctx.lineWidth = DROPPED_LINE_WIDTH * style.k
  ctx.setLineDash(UNCERTAIN_DASH.map((d) => d * style.k))
  ctx.beginPath()
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// --- "REVEALED" MARK --------------------------------------------------------------------

/**
 * drawRevealMark — the "revealed" mark of ONE life: a low halo and its rim, in the tint of
 * the team of the PLANTER of the sensor (it is their side that sees, not that of the
 * target).
 *
 * It is painted UNDER the marker of the player — the layer of placements passes before that
 * of the lives — so it surrounds it without ever covering it. Radius in PIXELS and not in
 * meters: it is not a range, it is a sign placed on a point.
 */
export function drawRevealMark(
  ctx: CanvasRenderingContext2D,
  c: XY,
  sinceMs: number,
  style: ShapeStyle,
  color: string,
): void {
  const alpha = revealAlpha(sinceMs, style.reducedMotion)
  if (!(alpha > 0)) return
  const r = REVEAL_RADIUS_PX * style.k
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.globalAlpha = alpha * REVEAL_FILL_ALPHA
  ctx.beginPath()
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = alpha
  ctx.lineWidth = REVEAL_WIDTH * style.k
  ctx.beginPath()
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// --- BEACON OF THE TRANSLOCATOR --------------------------------------------------------------

// --- THREAT SEEKER ------------------------------------------------------------------

/**
 * Duration of the UNIQUE impulse of the seeker, in milliseconds.
 *
 * DERIVED FROM THE WAVE OF THE SENSOR, and that is deliberate: the two objects emit the same
 * kind of event — an impulse that must read as a blow. Writing a second constant would
 * leave two divergent rhythms for a single gesture (CLAUDE.md #6).
 */
export const SEEKER_IMPULSE_MS = SENSOR_SWEEP_MS

/**
 * Radius reached by the impulse, in SCREEN pixels — NOT in meters, and that is the point.
 *
 * THE GAME PUBLISHES NO RANGE FOR THIS OBJECT. The official source that figures the threat
 * detector (range 4.25 wu, ping 1.8 s, reveal 0.75 s — cf. threatSensor.ts) says only one
 * thing of the seeker: "a projectile with ONE impulse that bounces". A radius in meters
 * would therefore be an invented range, and the layer would draw its zone. 14 px pass just
 * beyond the reveal mark (12 px): the event distinguishes itself from the mark it could
 * produce, without claiming to cover a field.
 */
export const SEEKER_IMPULSE_RADIUS_PX = 14

/** Thickness of the wave: sharp, it is an event (same value as the ping of the sensor). */
const SEEKER_IMPULSE_WIDTH = 2
const SEEKER_IMPULSE_ALPHA = SENSOR_PING_ALPHA

/** The wave of an impulse: its travel (as a fraction of the radius) and what it has left of
 * opacity. */
export interface ImpulseWave {
  reach: number
  alpha: number
}

/**
 * seekerImpulseActive — is the impulse in progress at this age?
 *
 * IT IS NEVER REPLAYED: one single impulse per placement, and after it there is NOTHING
 * left — no zone, no ring, no point. It is the difference in nature with the detector, which
 * pings every 1.8 s for its whole duration. The hover follows this window (cf.
 * `placementShows`): one does not inspect what is no longer drawn.
 */
export function seekerImpulseActive(ageMs: number): boolean {
  return ageMs >= 0 && ageMs < SEEKER_IMPULSE_MS
}

/**
 * seekerImpulse — the wave of the impulse, or null outside its window.
 *
 * FUNCTION OF TIME, NOT STATEFUL ANIMATION (same rule as `sensorPing` and `explosionFx`):
 * the same age always renders the same image, so a rewind replays what was seen. The
 * opening follows an easeOutCubic — the wave goes fast then calms down at the edge, the
 * pattern of an impulse.
 *
 * UNDER REDUCED MOTION, THE WAVE DOES NOT RUN BUT THE EVENT REMAINS: a motionless ring at
 * full radius, for the same window. Removing the wave without putting anything in its place
 * would make the family entirely invisible for those who ask for less motion.
 */
export function seekerImpulse(ageMs: number, reducedMotion: boolean): ImpulseWave | null {
  if (!seekerImpulseActive(ageMs)) return null
  if (reducedMotion) return { reach: 1, alpha: SEEKER_IMPULSE_ALPHA }
  const pr = ageMs / SEEKER_IMPULSE_MS
  return { reach: 1 - Math.pow(1 - pr, 3), alpha: (1 - pr) * SEEKER_IMPULSE_ALPHA }
}

/** drawSeekerImpulse — the ring of the unique impulse; nothing at all outside it. */
export function drawSeekerImpulse(
  ctx: CanvasRenderingContext2D,
  c: XY,
  ageMs: number,
  style: ShapeStyle,
  color: string,
): void {
  const wave = seekerImpulse(ageMs, style.reducedMotion)
  if (!wave || !(wave.reach > 0)) return
  ctx.save()
  ctx.strokeStyle = color
  ctx.globalAlpha = wave.alpha
  ctx.lineWidth = SEEKER_IMPULSE_WIDTH * style.k
  ctx.beginPath()
  ctx.arc(c.x, c.y, SEEKER_IMPULSE_RADIUS_PX * style.k * wave.reach, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

// --- REPAIR FIELD ------------------------------------------------------------------

/**
 * Radius of the repair field, in world meters. DECLARED VALUE, NOT MEASURED, NOT OFFICIAL.
 *
 * THE THREE POSSIBLE SOURCES ARE EMPTY, AND IT NEEDS TO BE SAID: the film carries no range
 * (neither in the creation record, nor in the life of the object — same finding as for the
 * detector); the official source that figures the detector does not figure this field; and
 * nothing was measured in the corpus. 3 m — 6 m in diameter — is a SCREEN choice, calibrated
 * on what the dome of the game shelters (a player and a teammate), and it stays under the
 * official range of the detector (4.25 m) so that the two disks are not confused.
 *
 * THE DOTTED LINE OF ITS BOUND CARRIES THIS RESERVE TO THE SCREEN (cf. UNCERTAIN_DASH): the
 * ring of the sensor is full because its range is published, that of the field is dotted
 * because its own is not. The day a range would be measured or published, it would replace
 * this constant — and the stroke would become full.
 */
export const REPAIR_FIELD_RADIUS_M = 3

/** Fill of the disk: very low — it is a zone, it must hide nothing. */
const REPAIR_FIELD_FILL_ALPHA = 0.12
const REPAIR_FIELD_RING_ALPHA = 0.5
const REPAIR_FIELD_RING_WIDTH = 1.25

/**
 * THE PHARMACY CROSS (V8, user request of 2026-08-18: "comme c'est un truc pour la santé tu
 * peux mettre une croix comme une croix de pharmacie qui pulse ? avec le cercle autour
 * évidemment" (since it is a thing for health can you put a cross like a pharmacy cross
 * that pulses? with the circle around it of course)).
 *
 * WHAT THE PULSE SAYS, AND WHAT IT DOES NOT SAY. It counts NOTHING: the film carries no
 * healing rate, and claiming the opposite would be inventing a measurement. It therefore
 * touches ONLY the cross — the disk and its dotted ring remain motionless, and they are
 * what carry the information (the zone, and the reserve on its range). The cross breathes
 * because an object that heals is ACTIVE, and a slow breathing is the only sign of activity
 * that figures nothing.
 *
 * UNDER REDUCED MOTION IT DOES NOT BREATHE, but it remains: the family must not become
 * invisible for those who ask for less motion (same rule as the wave of the seeker).
 */
const REPAIR_CROSS_PERIOD_MS = 1_800
/** Half-length of the cross, as a fraction of the radius of the field. */
const REPAIR_CROSS_REACH = 0.42
/** Thickness of the branch, same fraction: the cross keeps its proportions at every scale. */
const REPAIR_CROSS_ARM = 0.15
/** Smallest cross that remains legible, in screen pixels (BTB: 2.5 px/m). */
const REPAIR_CROSS_MIN_PX = 3.5
const REPAIR_CROSS_ALPHA_LOW = 0.55
const REPAIR_CROSS_ALPHA_HIGH = 0.95

/**
 * repairCrossAlpha — the opacity of the cross at this age: a slow breathing between two
 * bounds.
 *
 * FUNCTION OF TIME, NOT STATEFUL ANIMATION (same rule as `sensorPing` and
 * `seekerImpulse`): the same age always gives back the same image, so a rewind replays what
 * was seen. Under reduced motion, the high value, constant.
 */
export function repairCrossAlpha(ageMs: number, reducedMotion: boolean): number {
  if (reducedMotion) return REPAIR_CROSS_ALPHA_HIGH
  const phase = (1 - Math.cos((2 * Math.PI * ageMs) / REPAIR_CROSS_PERIOD_MS)) / 2
  return REPAIR_CROSS_ALPHA_LOW + (REPAIR_CROSS_ALPHA_HIGH - REPAIR_CROSS_ALPHA_LOW) * phase
}

/** What needs to be known of a field to trace it: where, up to where, and since when. */
export interface RepairFieldShape {
  c: XY
  /** Radius ALREADY converted to pixels: the conversion belongs to the layer, the only one
   * to see the framing. */
  radiusPx: number
  /** Age of the placement, in match milliseconds — it gives its phase to the breathing. */
  ageMs: number
}

/**
 * drawRepairField — the disk of the field, in the ink of the team of the planter, bounded
 * by a dotted line, and THE PHARMACY CROSS that breathes in its center (cf.
 * REPAIR_CROSS_PERIOD_MS).
 *
 * THE ZONE DOES NOT MOVE, ONLY THE CROSS BREATHES. It is the same distinction as for the
 * sensor — what asserts a measurement is motionless, what moves figures nothing. The disk
 * says the range (declared, hence the dotted line), the cross says "here, we heal".
 */
export function drawRepairField(
  ctx: CanvasRenderingContext2D,
  field: RepairFieldShape,
  style: ShapeStyle,
  color: string,
): void {
  const { c, radiusPx } = field
  if (!(radiusPx > 0)) return
  ctx.save()
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.globalAlpha = REPAIR_FIELD_FILL_ALPHA
  ctx.beginPath()
  ctx.arc(c.x, c.y, radiusPx, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = REPAIR_FIELD_RING_ALPHA
  ctx.lineWidth = REPAIR_FIELD_RING_WIDTH * style.k
  ctx.setLineDash(UNCERTAIN_DASH.map((d) => d * style.k))
  ctx.beginPath()
  ctx.arc(c.x, c.y, radiusPx, 0, Math.PI * 2)
  ctx.stroke()
  // THE CROSS: full stroke, inside the circle, never beyond its bound.
  ctx.setLineDash([])
  ctx.globalAlpha = repairCrossAlpha(field.ageMs, style.reducedMotion)
  const reach = Math.max(radiusPx * REPAIR_CROSS_REACH, REPAIR_CROSS_MIN_PX * style.k)
  const arm = Math.max(radiusPx * REPAIR_CROSS_ARM, REPAIR_CROSS_MIN_PX * style.k * 0.36)
  ctx.beginPath()
  ctx.rect(c.x - reach, c.y - arm, reach * 2, arm * 2)
  ctx.rect(c.x - arm, c.y - reach, arm * 2, reach * 2)
  ctx.fill()
  ctx.restore()
}

// The RIFT of the translocator and its teleportation arc live in `placementRift.ts`.
// The BUBBLE of the blackout screen (radius, fold duration, bolts) lives in
// `placementShroud.ts`.
