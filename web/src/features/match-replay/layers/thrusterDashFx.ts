/**
 * thrusterDashFx.ts — the THRUSTER PUSH on the pawn of the player: a short, oriented dash.
 *
 * THE SOURCE is the document (schema 38): `abilityImpulses`, a FLAT entry per gesture —
 * (t, slot, family) — read in the body `tag == 1` of the i57/i59 components of the film and
 * attributed by the ability rank of the SAME LIFE. No speed threshold, no heuristic. The
 * chain is validated against a ground truth: on the film `1cd3848a`, the user noted in the
 * Theater their five uses (1:51, 1:54, 2:03, 2:05, 2:14) and the layer dates five of them,
 * to within one second — precision 5/5, recall 5/5.
 *
 * ## Why the PAWN and not the card
 *
 * User decision (2026-09-03): "trop bref pour mettre sur la fiche mais un petit effet sur
 * le pion oui, fait un truc qui fait comme un dash" (too short to put on the card but a
 * small effect on the pawn yes, do something that acts like a dash). The gesture lasts half
 * a second; a card column or a thumbnail flash would not have shown it. What it shows is a
 * DISPLACEMENT — so it is drawn where the displacement is read, on the map.
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
 *
 * ## What this file does not do
 *
 * No off-screen layer, no re-baking: two projections and a handful of strokes per active
 * dash, all in pure geometry on a `CanvasRenderingContext2D` (same rule as `grappleLayer.ts`
 * and `replayDraw.ts`). The inks arrive ALREADY RESOLVED from the semantic tokens — no color
 * literal here.
 */
import type { ReplayPoint } from '@/lib/api/types'

import { positionAt, type XY } from '../../../lib/replay/replayLogic'
import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { type CanvasView, projectTo } from '../model/replayView'
import { buildLivesBySlot, lifeOfSlotAt } from '../model/livesPosition'

/**
 * THE FAMILIES DRAWN AS DASH. These are NOT all the families of the layer: a family absent
 * from this table draws NOTHING, never the shape of a neighbor (same rule as
 * `activeEquipmentAt` and as `PLACEMENT_RENDER`).
 *
 * The thruster is alone there, and the repulsor will not enter through this channel: it is
 * NOT in the ability impulses (negative measured on nine channels, lots R8/R9 of
 * 2026-09-03). Its PUSHS are drawn by `knockbackFx.ts` (schema 94).
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

/** A dash ready to draw: the instant, the life, its trajectory and its read direction. */
export interface ThrusterDashFx {
  /** Frame of the measured impulse — the effect starts from there, never before. */
  frame: number
  /** Slot of the life that pushes: the team color is resolved there, at the frame of the impulse. */
  slot: number
  /** The points of ITS life — the position of the pawn is re-read there at every frame, the dash follows it. */
  points: ReplayPoint[]
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
      points: track.points,
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

// --- Tracing geometry, in SCREEN pixels (multiplied by the density `k`) -----------------

/**
 * The wake starts BEHIND the marker, not on it: `DASH_GAP` detaches it from the core (3.4 px
 * of radius plus its rim) so that the pawn stays readable and the push reads as coming out.
 * Deliberately short length — it is a gesture, not a trail.
 */
const DASH_GAP = 5
const DASH_LEN = 20
const DASH_HALF_W = 3.2
/** The wake is a wash: it passes UNDER the chevrons, which carry the reading. */
const DASH_WAKE_ALPHA = 0.55
/**
 * Two chevrons — speed lines — placed along the wake. They point IN the direction of the
 * push: they are the ones that say the direction without adding an arrow.
 */
const CHEVRON_AT: readonly number[] = [0.5, 0.85]
const CHEVRON_HALF = 3.4
const CHEVRON_DEPTH = 2.6
const CHEVRON_WIDTH = 1.5

/** The clock of the layer: current frame, real duration of a frame, density, preference. */
interface DashTime {
  frame: number
  /** REAL duration of a frame — the effect lasts in ms of match, never in number of frames. */
  frameMs: number
  k: number
  reducedMotion: boolean
}

/** The style: the team color of the life that pushes. `null` = life without owner. */
export interface DashStyle {
  colorOfSlot: (slot: number, frame: number) => string | null
}

/**
 * drawThrusterDashLayer paints the active dashes at the current frame.
 *
 * THE COLOR IS RESOLVED AT THE FRAME OF THE IMPULSE, never at the current frame: a biped
 * slot is reassigned at the respawns, and the current frame can already belong to ANOTHER
 * life (same rule as `SensorReveal.ownerFrame`).
 */
export function drawThrusterDashLayer(
  ctx: CanvasRenderingContext2D,
  fx: readonly ThrusterDashFx[],
  view: CanvasView,
  time: DashTime,
  style: DashStyle,
): void {
  for (const f of fx) {
    const prog = dashProgress((time.frame - f.frame) * time.frameMs, time.reducedMotion)
    if (!prog) continue
    const color = style.colorOfSlot(f.slot, f.frame)
    if (!color) continue
    const head = positionAt(f.points, time.frame)
    if (!head) continue
    const dir = screenDirection(f, view)
    if (!dir) continue
    // SAVE PER DASH, like the grapple layer: the state of the context returns intact to the
    // caller, and a film without thruster does NOT emit a single call (the following layer
    // inherits exactly what it had before).
    ctx.save()
    drawDash(ctx, project(head, view), dir, prog, { k: time.k, color })
    ctx.restore()
  }
}

/**
 * screenDirection projects the two bounds of the reading and normalizes IN PIXELS.
 *
 * The normalization is done after projection and not before: the world -> canvas passage can
 * invert an axis and does not have the same scale in x and in y — a world unit vector would
 * not stay unitary there, nor even oriented the same way.
 */
function screenDirection(f: ThrusterDashFx, view: CanvasView): XY | null {
  const a = project(f.from, view)
  const b = project(f.to, view)
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (!(len > 0)) return null
  return { x: dx / len, y: dy / len }
}

/**
 * drawDash: the wake behind the pawn, then the chevrons that say the direction. `c` is the
 * center of the pawn in pixels, `u` the unit direction IN PIXELS. Exported for the repulsor
 * push (`knockbackFx.ts`), which draws the same wake on the pushed player.
 */
export function drawDash(
  ctx: CanvasRenderingContext2D,
  c: XY,
  u: XY,
  prog: DashProgress,
  paint: { k: number; color: string },
): void {
  const k = paint.k
  const n = { x: -u.y, y: u.x }
  const len = DASH_LEN * k * prog.reach
  // The wake: a wedge that starts from the edge of the marker and thins toward the tail.
  const bx = c.x - u.x * DASH_GAP * k
  const by = c.y - u.y * DASH_GAP * k
  const w = DASH_HALF_W * k
  ctx.fillStyle = paint.color
  ctx.strokeStyle = paint.color
  ctx.globalAlpha = prog.alpha * DASH_WAKE_ALPHA
  ctx.beginPath()
  ctx.moveTo(bx + n.x * w, by + n.y * w)
  ctx.lineTo(bx - n.x * w, by - n.y * w)
  ctx.lineTo(bx - u.x * len, by - u.y * len)
  ctx.closePath()
  ctx.fill()
  // The chevrons, placed along the wake and pointing in the direction of the push.
  ctx.globalAlpha = prog.alpha
  ctx.lineWidth = CHEVRON_WIDTH * k
  for (const at of CHEVRON_AT) {
    const px = bx - u.x * len * at
    const py = by - u.y * len * at
    ctx.beginPath()
    ctx.moveTo(px + n.x * CHEVRON_HALF * k, py + n.y * CHEVRON_HALF * k)
    ctx.lineTo(px + u.x * CHEVRON_DEPTH * k, py + u.y * CHEVRON_DEPTH * k)
    ctx.lineTo(px - n.x * CHEVRON_HALF * k, py - n.y * CHEVRON_HALF * k)
    ctx.stroke()
  }
}

function project(p: XY, view: CanvasView): XY {
  return projectTo(view, p)
}
