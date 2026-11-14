/**
 * objectivesLayer.ts — the STATIC LAYER of the objectives of the mode played (lot 4):
 * normalization, geometry and action pulses. Pure logic, no React.
 *
 * THE LIVING STATE OF THE ZONES LIVES BESIDE IT (`zoneStatesLayer.ts`, schema 16). The
 * boundary is that of TIME: here the geometry, which never changes and is cooked once
 * off-screen; there the state, which changes at every frame and is painted in the loop. The
 * two trace the SAME shape — `traceZonePath` is exported for that, rather than copied.
 *
 * THE PULSES STAY, AND THAT IS NOT A DUPLICATION. They mark the INSTANT of an action (a
 * capture just took place, a ring opens and fades); the living state, for its part,
 * describes a DURATION. The tint flip of a zone is indeed what the pulse announces — the two
 * are read together, one punctual, the other continuous.
 *
 * EXCEPT FOR THE FLAG, AND THAT IS LOT 3.1 (schema 15). The CTF pulse was NOT an announced
 * instant: it was a SUBSTITUTE, for lack of an object — it placed the action on the static
 * element closest to its author, that is, on a neighboring pedestal, never on the flag.
 * Since `flagCarries` publishes the object itself (position, carrier, state, frame by
 * frame), this substitute would say the SAME thing less precisely, and the two would
 * contradict each other on screen. It is therefore REMOVED as soon as the document carries
 * flags (cf. `buildObjectivePulses`). The zone and Oddball pulses, for their part, have no
 * living object and keep their whole role — the function is therefore not removed, only the
 * flag FAMILY comes out.
 *
 * AND ONLY THE OBJECTIVE FAMILIES MAKE ONE (D.1, 2026-09-13). `doc.objectives` is not a list
 * of objectives: it carries EVERYTHING the statborg knows to name, `kills` and `assists`
 * included — the identity anchor of the sweep and its cross-check (`objectiveevents/named.go`).
 * On `8bc6074f` that made 15,648 pulses built per scene frame for 160 real objective
 * actions (audit of 2026-09-10 §12-1), and a capture ring lit at every frag. The sorting is
 * done on the FAMILY of the name (`model/objectiveFamilies.ts`), not on a list of
 * statistics: it is the only discriminant that the transport contract publishes.
 *
 * WHAT THE SERVER HAS ALREADY DECIDED, and that this layer does not replay: which roles to
 * serve (table of the title joined to the pair_name), which teams to display (the modes with
 * dynamic possession arrive neutral). The front draws WHAT ARRIVES — a document without
 * `mapObjectives` simply has no layer.
 *
 * NO LABEL, AND THAT IS A RULE: the letter A/B/C displayed in game exists in no decoded data
 * (the spatial rank of the server is NOT a name, cf. objectives_catalog.go). This layer
 * therefore NEVER writes text — the guard "drawObjectivesLayer does not call fillText nor
 * strokeText" is tested.
 *
 * GEOMETRY: same world -> canvas transforms as structure/tracks (worldToCanvas, canvasScale).
 * A box arrives in half extents + Forward vector (projected to the plane, normalized here);
 * a cylinder in world radius. The markers are POINTS: a diamond (appearance/pedestal),
 * doubled by a ring for a delivery — never an invented zone disk (rule shape.go).
 *
 * ALTITUDE IS STATED AS THAT OF THE PLAYERS (2026-09-18). An objective carried a `z` that no
 * one read: a flag pedestal on a floor was drawn exactly like a pedestal on the ground,
 * while the pawns stated their floor by rings. The layer now speaks the same language,
 * without text: a MARKER carries `fl` concentric rings (`floorRings.ts`, the loop of the
 * pawns), a ZONE carries `fl` concentric OUTER outlines — outer because the living layer
 * (`zoneStatesLayer`) repaints the inside of the shape when the zone is held, and would
 * cover what was baked there. The floor is that of `floorOf`, on the vertical amplitude of
 * the document (`ObjectivesStyle.z`); a FLAT terrain gives none (cf. `floorInRange`, guard
 * shared with the pawns).
 */
import type { ReplayMapObjectives } from '@/lib/api/types'

import { buildCarrierPosAt } from '../model/carrierPosition'
import { objectiveFamilyOf } from '../model/objectiveFamilies'
import { drawFloorRings, floorInRange, FLOOR_RING_ALPHA, FLOOR_RING_ALPHA_DECAY, FLOOR_RING_GAP } from './floorRings'
import { type XY } from '../../../lib/replay/replayLogic'
import { filmClockTrusted } from '@/lib/replay/scoreTimeline'

import type { ReplayDocumentReady } from '../../../lib/replay/replayNormalize'
import { type CanvasView, projectTo, scaleOf } from '../model/replayView'

/** "No side" value of team_index — that of the map file, served as is. */
export const OBJECTIVE_TEAM_NEUTRAL = -1

/** An objective element ready to draw: nullability resolved, Forward normalized 2D. */
export interface ObjectiveElementReady {
  role: string
  /** Team index TO DISPLAY: -1 = neutral (already arbitrated on the server side). */
  team: number
  x: number
  y: number
  z: number
  kind: 'zone' | 'marker'
  family?: 'box' | 'cylinder'
  /** Box: world half extents along fwd and its perpendicular. */
  halfX: number
  halfY: number
  /** Cylinder: world radius. */
  radius: number
  /** Axis of the box, unit 2D (the degenerate frames are refused on the server side). */
  fwd: XY
}

/**
 * normalizeMapObjectives resolves the nullability of the transport ONCE, at the entry (same
 * rule as normalizeCallouts). The order served (server spatial sort) is kept.
 */
export function normalizeMapObjectives(
  mo: ReplayMapObjectives | null | undefined,
): ObjectiveElementReady[] {
  if (!mo) return []
  const out: ObjectiveElementReady[] = []
  for (const z of mo.zones ?? []) {
    out.push({
      role: z.role,
      team: z.team,
      x: z.x,
      y: z.y,
      z: z.z,
      kind: 'zone',
      family: z.family === 'cylinder' ? 'cylinder' : 'box',
      halfX: z.halfX ?? 0,
      halfY: z.halfY ?? 0,
      radius: z.radius ?? 0,
      fwd: unit2D(z.fwdX, z.fwdY),
    })
  }
  for (const m of mo.markers ?? []) {
    out.push({
      role: m.role,
      team: m.team,
      x: m.x,
      y: m.y,
      z: m.z,
      kind: 'marker',
      halfX: 0,
      halfY: 0,
      radius: 0,
      fwd: { x: 1, y: 0 },
    })
  }
  return out
}

/**
 * unit2D normalizes the projection to the plane of the Forward. The server refuses the
 * degenerate frames (mapvar) and the Up axis of the zones is vertical on the whole measured
 * catalog: the projection is therefore a non-null horizontal vector — the fallback (1,0)
 * only serves as a belt if a future data violated the invariant, and it returns an aligned
 * box.
 */
function unit2D(x: number | undefined, y: number | undefined): XY {
  const vx = x ?? 0
  const vy = y ?? 0
  const n = Math.hypot(vx, vy)
  if (n < 1e-6) return { x: 1, y: 0 }
  return { x: vx / n, y: vy / n }
}

/** Style of the layer: the team color is RESOLVED by the caller (color-tokens rule). */
export interface ObjectivesStyle {
  /** Color of a team index; -1 (neutral) returns the neutral ink of the theme. */
  colorOfTeam: (team: number) => string
  /**
   * THE RIM OF AN OBJECTIVE WITHOUT SIDE (2026-09-08) — the ink of the BACKGROUND, placed
   * under the outline.
   *
   * It exists ONLY for `team === -1`, and that is its whole meaning: a held objective
   * carries the color of its side, which already detaches it; a neutral objective is gray,
   * and a gray placed on a photographic map background dissolves depending on the zone. The
   * rim in the ink of the background gives it a sharp edge without inventing it a color —
   * the same technique as the flag glyph and the marks (`useReplayInks.mark.outline`), and
   * the only one that works in BOTH themes.
   */
  neutralOutline: string
  /**
   * THE VERTICAL AMPLITUDE OF THE DOCUMENT (`doc.bounds.minZ/maxZ`, the same as that of the
   * pawns): it is on it that `floorOf` ranges a `z` into a floor. Without it, an objective
   * cannot state its height in the language of the players.
   */
  z: { min: number; max: number }
}

/** `team` of an objective that NO ONE holds — arbitrated on the server side. */
const TEAM_NONE = -1

// Settings of the layer: sharp enough to read under the trajectories, low enough not to
// compete with the players (same orders of magnitude as the callouts).
const ZONE_FILL_ALPHA = 0.09
const ZONE_STROKE_ALPHA = 0.6
const ZONE_STROKE_WIDTH = 1.5
/** Overhang of the rim of an objective WITHOUT SIDE, on each side of the outline (cf. ObjectivesStyle). */
const ZONE_RIM_PAD = 1.2
const MARKER_SIZE = 5.5
const MARKER_RING = 8
const MARKER_ALPHA = 0.9
/**
 * First FLOOR ring of a marker: BEYOND the delivery ring (8 px), otherwise the two would
 * blend and a ground delivery would read "on a floor". The step of a ring (`FLOOR_RING_GAP`)
 * beyond the delivery radius: the gap between the delivery ring and the first floor ring is
 * then the same as between two floor rings.
 */
const MARKER_FLOOR_RING_FIRST = MARKER_RING + FLOOR_RING_GAP
/**
 * Step of a zone floor outline, in SCREEN PIXELS: the same as that of the rings, so that the
 * eye counts the same thing. Outline n° r is offset by r times this step outward, which
 * leaves it beyond the thickest stroke of the living layer (3.5 px, i.e. 1.75 px of
 * overhang) — never covered.
 */
const ZONE_FLOOR_PAD_STEP = FLOOR_RING_GAP
const ZONE_FLOOR_STROKE_WIDTH = 1
/**
 * drawObjectivesLayer paints zones then markers. STATIC layer — the caller cooks it
 * off-screen and copies it, like the ground and the callouts. NO TEXT (cf. header).
 */
export function drawObjectivesLayer(
  ctx: CanvasRenderingContext2D,
  elements: ObjectiveElementReady[],
  view: CanvasView,
  style: ObjectivesStyle,
): void {
  const px = (p: XY) => projectTo(view, p)
  const scale = scaleOf(view)

  for (const e of elements) {
    const color = style.colorOfTeam(e.team)
    const rim = e.team === TEAM_NONE ? style.neutralOutline : null
    if (e.kind === 'zone') drawZone(ctx, e, { px, scale, color, rim, fl: floorInRange(e.z, style.z) })
  }
  // The markers on top of the zones: a punctual delivery sometimes lives INSIDE its
  // cylinder (measured on Catalyst) and must stay visible.
  for (const e of elements) {
    if (e.kind !== 'marker') continue
    const rim = e.team === TEAM_NONE ? style.neutralOutline : null
    drawMarker(ctx, e, px, { color: style.colorOfTeam(e.team), rim, fl: floorInRange(e.z, style.z) })
  }
  ctx.globalAlpha = 1
}

/** What a zone must know to be painted: projection, inks and floor. */
export interface ZoneDrawing {
  px: (p: XY) => XY
  scale: number
  color: string
  rim: string | null
  /** Floor (0 = ground): as many outer concentric outlines. */
  fl: number
}

/**
 * Zone: ORIENTED box (4 world corners) or cylinder (world radius -> pixels), then its floor
 * outlines on the OUTSIDE — one per floor, progressively paler, like the rings of a pawn.
 */
function drawZone(
  ctx: CanvasRenderingContext2D,
  e: ObjectiveElementReady,
  d: ZoneDrawing,
): void {
  const { px, scale, color, rim } = d
  traceZonePath(ctx, e, px, scale)
  ctx.globalAlpha = ZONE_FILL_ALPHA
  ctx.fillStyle = color
  ctx.fill()
  // THE RIM FIRST, THICKER, AND THE OUTLINE ON TOP: that is what leaves it a sharp edge on a
  // light background as on a dark one. The reverse order would eat it.
  if (rim !== null) {
    ctx.globalAlpha = ZONE_STROKE_ALPHA
    ctx.strokeStyle = rim
    ctx.lineWidth = ZONE_STROKE_WIDTH + 2 * ZONE_RIM_PAD
    ctx.stroke()
  }
  ctx.globalAlpha = ZONE_STROKE_ALPHA
  ctx.strokeStyle = color
  ctx.lineWidth = ZONE_STROKE_WIDTH
  ctx.stroke()
  drawZoneFloorContours(ctx, e, d)
}

/**
 * drawZoneFloorContours: `fl` concentric OUTER outlines, each offset by
 * `ZONE_FLOOR_PAD_STEP` pixels, traced by THE SAME geometry as the zone (`traceZonePath`
 * and its `padPx`). Thin stroke, same color, decreasing opacity — the same paling as the
 * rings.
 */
export function drawZoneFloorContours(
  ctx: CanvasRenderingContext2D,
  e: ObjectiveElementReady,
  d: ZoneDrawing,
): void {
  if (d.fl <= 0) return
  ctx.strokeStyle = d.color
  ctx.lineWidth = ZONE_FLOOR_STROKE_WIDTH
  for (let r = 1; r <= d.fl; r++) {
    ctx.globalAlpha = FLOOR_RING_ALPHA - FLOOR_RING_ALPHA_DECAY * (r - 1)
    traceZonePath(ctx, e, d.px, d.scale, ZONE_FLOOR_PAD_STEP * r)
    ctx.stroke()
  }
}

/** What a marker must know to be painted: inks and floor. */
interface MarkerDrawing {
  color: string
  rim: string | null
  /** Floor (0 = ground): as many concentric rings, beyond the delivery ring. */
  fl: number
}

/**
 * Marker: solid DIAMOND (appearance, pedestal); a DELIVERY (`*_delivery`) gains a ring —
 * it is a point of arrival, not an appearance, and the difference reads without text. The
 * FLOOR rings come first, under the silhouette, like on a pawn.
 */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  e: ObjectiveElementReady,
  px: (p: XY) => XY,
  { color, rim, fl }: MarkerDrawing,
): void {
  const c = px(e)
  drawFloorRings(ctx, c, fl, color, { first: MARKER_FLOOR_RING_FIRST })
  ctx.globalAlpha = MARKER_ALPHA
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.moveTo(c.x, c.y - MARKER_SIZE)
  ctx.lineTo(c.x + MARKER_SIZE, c.y)
  ctx.lineTo(c.x, c.y + MARKER_SIZE)
  ctx.lineTo(c.x - MARKER_SIZE, c.y)
  ctx.closePath()
  // Same gesture as the zone: the rim under the silhouette, never on top (cf. drawZone).
  if (rim !== null) {
    ctx.strokeStyle = rim
    ctx.lineWidth = 2 * ZONE_RIM_PAD
    ctx.stroke()
    ctx.strokeStyle = color
  }
  ctx.fill()
  if (e.role.endsWith('_delivery')) {
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(c.x, c.y, MARKER_RING, 0, Math.PI * 2)
    ctx.stroke()
  }
}

/**
 * flagPulsesRetired says whether the flag FAMILY of the pulses must stay silent: it stays
 * silent as soon as the document publishes the lives of the flags, because then the
 * substitute has an EXACT replacement.
 *
 * It is NOT conditioned to the display flip of the layer: a reader who turns off the flags
 * asks for less on the screen, not the return of an approximation.
 */
export function flagPulsesRetired(doc: ReplayDocumentReady): boolean {
  return doc.flagCarries.length > 0
}

/** A pulse: an OBJECTIVE ACTION (doc.objectives) placed on its closest element. */
export interface ObjectivePulse {
  frame: number
  x: number
  y: number
  team: number
}

/**
 * buildObjectivePulses pairs each objective action of the document with the served element
 * closest to its AUTHOR at the instant of the action (position re-read by
 * `buildCarrierPosAt`: the VEHICLE when the author is embarked in it, otherwise their biped
 * lives and the same after-death window as the death layer).
 *
 * THE PROXIMITY IS 2D: the interpolated position of a trace is XY (the z does not travel in
 * positionAt), and the objectives of the same mode do not overlap in plan on the measured
 * maps. An action without a re-read position is SET ASIDE — a pulse placed at random would
 * designate the wrong zone.
 *
 * `a.t` IS ALREADY A FRAME OF THE DOCUMENT — THE CLIENT SUBTRACTS NOTHING. That is the
 * contract of the field, written on the Go side: `ObjectiveAction.T` is "the frame index,
 * on the same axis as Point.T and Shot.T" (`games/halo_infinite/film/replay/objectives.go`),
 * and it is `buildObjectiveActions` that places the instant on the grid via
 * `scoreClock.frameOf` — which SUBTRACTS the origin (`build_score.go`, `replayScoreClock`:
 * `originMS = originMSOf(doc.OriginMs, …)`).
 *
 * THIS FUNCTION SUBTRACTED IT A SECOND TIME (review R1, 2026-08-18). The correction had
 * been done on the client side on 2026-08-14 (lot containment), then on the Go side at lot A
 * phase 1 (`63b90583c`, report `:123` of the register) without the former being removed. The
 * double offset lit the pulses `originMs` TOO SOON — from 3.6 s to 50.8 s depending on the
 * match — and THREW away, purely and simply, the actions whose frame was lower than this
 * origin.
 *
 * The feed of the eliminations, for its part, keeps its subtraction (`killFeedLogic`,
 * `replayMs = event_time_ms + t0Ms − originMs`) and that is not an inconsistency: its
 * instants come from the Match View, not from the film — no one had realigned them before it.
 */
export function buildObjectivePulses(
  doc: ReplayDocumentReady,
  elements: ObjectiveElementReady[],
): ObjectivePulse[] {
  if (elements.length === 0 || doc.objectives.length === 0 || doc.tracks.length === 0) return []
  // THE ORIGIN MUST BE KNOWN FOR `a.t` TO MEAN ANYTHING (P2 of the review of lot A phase 1).
  // The realignment is done on the Go side, but with ZERO when the origin could not be
  // established (`replayScoreClock` → `originMSOf`): the published frames are then offset by
  // 3.6 s to 50.8 s depending on the match, and the pairing would read the position of the
  // author elsewhere. `coverage.originResolved` says it, and a silent layer is worth better
  // than a wrong one — it is the SAME rule that masks the score (cf. filmClockTrusted).
  if (!filmClockTrusted(doc)) return []
  // THE SUBSTITUTE OF THE FLAG COMES OUT HERE, at the source, rather than at the tracing: a
  // pulse built then not drawn would stay in the memory of the scene and in the dependencies
  // of `draw`.
  const dropFlags = flagPulsesRetired(doc)
  const posOf = buildCarrierPosAt(doc)
  const out: ObjectivePulse[] = []
  for (const a of doc.objectives) {
    // ONLY THE OBJECTIVE FAMILIES MAKE A PULSE (cf. the header, D.1 of 2026-09-13): the
    // frags and the assists travel in the same array and have nothing to announce here.
    const family = objectiveFamilyOf(a.stat)
    if (family === null) continue
    if (dropFlags && family === 'flag') continue
    // NO REALIGNMENT HERE: `a.t` is already a frame of the document (cf. header). The action
    // that the grid did not carry was counted outside the window on the Go side and is not
    // published.
    const frame = a.t
    const pos = posOf(a.xuid, frame)
    if (!pos) continue
    let best: ObjectiveElementReady | null = null
    let bd = Infinity
    for (const e of elements) {
      const dx = e.x - pos.x
      const dy = e.y - pos.y
      const d = dx * dx + dy * dy
      if (d < bd) {
        bd = d
        best = e
      }
    }
    if (!best) continue
    out.push({ frame, x: best.x, y: best.y, team: best.team })
  }
  return out
}

/** Display window of a pulse (shape of EventWindow of replayDraw). */
interface PulseWindow {
  frame: number
  hold: number
}

/**
 * drawObjectivePulses draws the pulses of the current window: a ring that OPENS from the
 * element (the action just took place there) then fades. Under "reduced motion": static
 * ring, constant opacity — same rule as the other effects.
 */
export function drawObjectivePulses(
  ctx: CanvasRenderingContext2D,
  pulses: ObjectivePulse[],
  view: CanvasView,
  win: PulseWindow,
  style: Pick<ObjectivesStyle, 'colorOfTeam'>,
  reducedMotion: boolean,
): void {
  for (const p of pulses) {
    const age = win.frame - p.frame
    if (age < 0 || age > win.hold) continue
    const k = age / Math.max(win.hold, 1)
    const c = projectTo(view, p)
    ctx.strokeStyle = style.colorOfTeam(p.team)
    ctx.lineWidth = 2
    ctx.globalAlpha = reducedMotion ? 0.6 : 0.9 * (1 - k)
    ctx.beginPath()
    ctx.arc(c.x, c.y, reducedMotion ? 11 : 7 + 14 * k, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

/**
 * zoneCornersWorld returns the FOUR WORLD CORNERS of a box zone: center ± fwd·halfX ±
 * perp·halfY. The perpendicular is the fwd rotated by +90° world — the Y axis inversion is
 * carried by `worldToCanvas`, never here.
 *
 * IT IS EXPORTED, AND THAT IS THE REASON FOR THE EXTRACTION (2026-08-25, item D-R). Two
 * readers need this formula: the TRACING of the outline (`traceZonePath`) and the SCREEN
 * FOOTPRINT of the zone (`zoneStatesLayer`, to clip the progressive fill of the capture).
 * Copying it would do exactly what the header of `traceZonePath` already forbade — two
 * geometries that diverge at the first fix, with an invisible gap because plausible.
 */
export function zoneCornersWorld(e: ObjectiveElementReady, padWorld = 0): XY[] {
  const perp = { x: -e.fwd.y, y: e.fwd.x }
  const hx = e.halfX + padWorld
  const hy = e.halfY + padWorld
  return [
    { x: e.x + e.fwd.x * hx + perp.x * hy, y: e.y + e.fwd.y * hx + perp.y * hy },
    { x: e.x - e.fwd.x * hx + perp.x * hy, y: e.y - e.fwd.y * hx + perp.y * hy },
    { x: e.x - e.fwd.x * hx - perp.x * hy, y: e.y - e.fwd.y * hx - perp.y * hy },
    { x: e.x + e.fwd.x * hx - perp.x * hy, y: e.y + e.fwd.y * hx - perp.y * hy },
  ]
}

/**
 * zoneCanvasRadius returns the SCREEN radius of a cylindrical zone, floor included. Exported
 * for the same reason as `zoneCornersWorld`: the tracing and the footprint must read THE
 * SAME radius, including its floor — otherwise the footprint and the outline would offset on
 * the tiniest zones.
 */
export function zoneCanvasRadius(e: ObjectiveElementReady, scale: number): number {
  return Math.max(e.radius * scale, 2)
}

/**
 * traceZonePath places the outline of a zone — ORIENTED box (4 world corners) or cylinder
 * (world radius -> pixels).
 *
 * IT IS EXPORTED BECAUSE TWO LAYERS TRACE IT: this one (geometry, cooked once) and the
 * living state of the zones (`zoneStatesLayer.ts`, repainted at every frame). Two copies of
 * the same shape would diverge at the first geometry fix — and the gap would be invisible:
 * an outline slightly wrong stays plausible.
 *
 * `padPx` (2026-09-18) DILATES the shape by this number of screen pixels, outward — that is
 * what traces the floor outlines without a second copy of the geometry: a cylinder gains
 * `padPx` on its screen radius, a box gains `padPx / scale` on each world half extent. At 0
 * (default), the exact shape.
 */
export function traceZonePath(
  ctx: CanvasRenderingContext2D,
  e: ObjectiveElementReady,
  px: (p: XY) => XY,
  scale: number,
  padPx = 0,
): void {
  ctx.beginPath()
  if (e.family === 'cylinder') {
    const c = px(e)
    ctx.arc(c.x, c.y, zoneCanvasRadius(e, scale) + padPx, 0, Math.PI * 2)
    return
  }
  zoneCornersWorld(e, padPx / scale).forEach((w, i) => {
    const c = px(w)
    if (i === 0) ctx.moveTo(c.x, c.y)
    else ctx.lineTo(c.x, c.y)
  })
  ctx.closePath()
}
