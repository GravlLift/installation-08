/**
 * thrusterDashFx.ts — the THRUSTER PUSH: when each measured use happens, which way it pushed, and
 * the timing of its effect. The 3D view's exhaust (`scene3d/thruster3d`) and the game's dodge and
 * evade clips (`scene3d/equipmentUse3d_logic`) read it; the 2D dash on the pawn was retired.
 *
 * THE SOURCE is the document (schema 38): `abilityImpulses`, a FLAT entry per gesture —
 * (t, slot, family) — read in the body `tag == 1` of the i57/i59 components of the film and
 * attributed by the ability rank of the SAME LIFE. No speed threshold, no heuristic. The
 * chain is validated against a ground truth: on the film `1cd3848a`, the user noted in the
 * Theater their five uses (1:51, 1:54, 2:03, 2:05, 2:14) and the layer dates five of them,
 * to within one second — precision 5/5, recall 5/5.
 *
 * ## Where the DIRECTION comes from, and why it is not in the event
 *
 * The impulse carries neither heading nor vector: it dates the gesture, nothing else. The
 * direction is therefore READ in the trajectory of the carrier around the instant
 * (`tracks[].points`, the same interpolation as the marker). Window BEFORE first — the push
 * follows the trigger, measured at a peak of 6.2-8.8 m/s against 2.9-3.6 for an ordinary
 * instant — then fallback to the AFTER window when the life closes within the second (death
 * during the dash: `positionAt` then freezes the last position, the before window becomes
 * zero).
 *
 * WITHOUT A MEASURABLE DIRECTION, NOTHING IS DRAWN. A dash without orientation would be an
 * invented shape; the doctrine of the workstream is that the replay stays silent rather than
 * guess.
 */
import type { ReplayPoint } from '@/lib/api/types'

import { positionAt, type XY } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { buildLivesBySlot, lifeOfSlotAt } from '../model/livesPosition'

/**
 * THE FAMILIES DRAWN AS DASH. These are NOT all the families of the layer: a family absent
 * from this table draws NOTHING, never the shape of a neighbor (same rule as
 * `activeEquipmentAt` and as `PLACEMENT_RENDER`).
 *
 * The thruster is alone there, and the repulsor will not enter through this channel: it is
 * NOT in the ability impulses (negative measured on nine channels, lots R8/R9 of
 * 2026-09-03). Its pushes are `knockbacks` (schema 94, `knockbackFx.ts`).
 */
const DASH_FAMILIES: ReadonlySet<string> = new Set(['thruster'])

/**
 * DURATION OF THE EFFECT, in REAL match time (not in frames): the dash is a short gesture,
 * it must last as little in accelerated reading as at 1x. 460 ms — the half second of the
 * gesture.
 */
export const THRUSTER_DASH_MS = 460

/**
 * READING WINDOW OF THE DIRECTION, in real time. 280 ms: long enough for the push to have
 * produced a clear displacement (1.7 to 2.5 m at the measured peak), short enough not to
 * absorb a turn that would follow the dash.
 */
export const THRUSTER_DASH_HEADING_MS = 280

/**
 * NUMERIC FLOOR of the direction reading, in world units. This is NOT a detection threshold
 * — the gesture is published by the film, never deduced from a speed: it is the guard that
 * prevents normalizing a zero vector (frozen life, clamped position after the death).
 */
const HEADING_MIN = 0.05

/** A measured push: the instant, the life and its read direction. */
export interface ThrusterDashFx {
  /** Frame of the measured impulse — the effect starts from there, never before. */
  frame: number
  /** Slot of the life that pushes: the team color is resolved there, at the frame of the impulse. */
  slot: number
  /** Start of the direction reading, in world. */
  from: XY
  /** End of the direction reading, in world. The direction is `to - from`, projected. */
  to: XY
}

/**
 * dashHeading reads the direction of the gesture in the trajectory, around the instant.
 *
 * TWO WINDOWS, IN THIS ORDER: the BEFORE one (the push follows the trigger) then the AFTER
 * one (fallback when the life closes during the dash). Neither of the two measures a speed:
 * they only serve to orient a shape whose existence, for its part, is published by the film.
 */
export function dashHeading(
  points: ReplayPoint[],
  frame: number,
  span: number,
): { from: XY; to: XY } | null {
  const at = positionAt(points, frame)
  if (!at) return null
  const after = positionAt(points, frame + span)
  if (after && dist2(at, after) > HEADING_MIN * HEADING_MIN) return { from: at, to: after }
  const before = positionAt(points, frame - span)
  if (before && dist2(before, at) > HEADING_MIN * HEADING_MIN) return { from: before, to: at }
  return null
}

function dist2(a: XY, b: XY): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  return dx * dx + dy * dy
}

/**
 * buildThrusterDashFx precomputes the drawable dashes: each impulse of a drawable family,
 * joined to THE LIFE THAT COVERS ITS INSTANT and to its direction read once for all.
 *
 * ONE TRACE = ONE LIFE, AND THE BIPED SLOT IS REASSIGNED AT EACH RESPAWN. It is the invariant
 * of the folder (`shotFx.ts`, `fireMark.ts`, `riftStations.ts`, `replayMarkers.ts`) and it
 * admits no shortcut: indexing `slot -> points` would keep only the LAST track of the slot,
 * and an impulse of an earlier life would go fetch the points of another life — at best it
 * would disappear (the instant precedes the kept points, `positionAt` returns `null`), at
 * worst it would paint a wake at the position and in the direction OF ANOTHER PLAYER. We
 * therefore group by slot, then keep the life that COVERS the instant — the exact pattern of
 * `buildShotFx` and `buildFireMarks`.
 *
 * `spanFrames` is the direction window CONVERTED by the caller (the hook), because the
 * duration of a frame depends on the document. An impulse without a covering life or without
 * a measurable direction produces NO entry — the layer only draws what it can orient.
 */
export function buildThrusterDashFx(
  doc: ReplayDocumentReady,
  spanFrames: number,
): ThrusterDashFx[] {
  if (doc.abilityImpulses.length === 0) return []
  const bySlot = buildLivesBySlot(doc.tracks)
  const out: ThrusterDashFx[] = []
  for (const imp of doc.abilityImpulses) {
    if (!DASH_FAMILIES.has(imp.family)) continue
    const track = lifeOfSlotAt(bySlot, imp.slot, imp.t)
    if (!track || track.points.length === 0) continue
    const heading = dashHeading(track.points, imp.t, spanFrames)
    if (!heading) continue
    out.push({
      frame: imp.t,
      slot: imp.slot,
      from: heading.from,
      to: heading.to,
    })
  }
  return out
}

/** The state of the dash at a given age: how far it stretches, and with what presence. */
export interface DashProgress {
  /** Part of the full length, in [0, 1]. */
  reach: number
  alpha: number
}

/** Presence of the wake: clear at the start, extinguished at the end of the window. */
const DASH_ALPHA = 0.9
/**
 * UNDER REDUCED MOTION, the shape no longer moves and no longer fades: it is PLACED, full
 * length and constant opacity, for its whole window. It is the convention of `revealAlpha`
 * (threatSensor.ts) — the information remains, the animation goes out — and a lower opacity
 * compensates the absence of fade, which would otherwise make an immobile blot too heavy on
 * the map.
 */
const DASH_ALPHA_STATIC = 0.55

/**
 * dashProgress says what must be drawn at this age, or `null` outside the window.
 *
 * The stretch follows an easeOutCubic: the push starts fast then settles — the same pattern
 * as the wave of the sensor and as the shock wave of the explosion, for the same reason:
 * that is how an impulse is read.
 */
export function dashProgress(ageMs: number, reducedMotion: boolean): DashProgress | null {
  if (!(ageMs >= 0) || ageMs > THRUSTER_DASH_MS) return null
  if (reducedMotion) return { reach: 1, alpha: DASH_ALPHA_STATIC }
  const p = ageMs / THRUSTER_DASH_MS
  return { reach: 1 - Math.pow(1 - p, 3), alpha: (1 - p) * DASH_ALPHA }
}
