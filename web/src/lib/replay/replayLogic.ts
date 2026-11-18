// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayLogic.ts — PURE logic of the 2D replay (interpolation, projection, reading).
 * No React nor canvas → unit-testable (anti-pattern "logic in the component").
 */
import type { ReplayBounds, ReplayMapObject, ReplayPoint } from '@/lib/api/types'

import { matchClock } from './matchClock'
import type { ReplayDocumentReady, ReplayTrackReady } from './replayNormalize'
import type { ReplayCutPoint } from './replayReadyTypes'

export interface XY {
  x: number
  y: number
}

/**
 * "1×" playback rate when the artifact carries no time scale (frameIntervalMs absent, older
 * artifacts): the T axis is then a plain index.
 */
const FALLBACK_FPS = 60

/** Number of altitude bands offered as "floors". */
export const FLOOR_BANDS = 3

/**
 * THE REPLICATION GAPS (`Point.g`, lot 1.9.13 on the Go side; read here since 2026-09-23, lot
 * L1.4 of the replay feedback, decision Q14). A point carrying `g > 0` says: "before me, the
 * film replicated NOTHING for `g` ms — do not interpolate across, neither segment nor
 * intermediate position" (`film/replay/document_aim.go`, field G). During a gap, the position
 * (and the altitude) is therefore HELD at the last point that precedes it; the trail never
 * joins its two sides; the pawn's drawing pales it (`inGapAt`, `layers/replayMarkers.ts`).
 * Before this reading, a pawn slid for tens of seconds toward a distant point (974 gaps in the
 * fleet, 222 over 10 m).
 */
function isGapPoint(p: { g?: number }): boolean {
  return (p.g ?? 0) > 0
}

/**
 * A point that BREAKS the line: a replication gap (`g`) OR the cut of a translocation (`cut`,
 * set by `translocationCuts.ts`). Position, altitude and trail are never interpolated across it;
 * only the gap pales the pawn (`inGapAt`) — after a translocation, the player is present and
 * seen.
 */
function breaksLine(p: { g?: number; cut?: boolean }): boolean {
  return isGapPoint(p) || p.cut === true
}

/**
 * bracketAt returns the two samples that bracket `t` (`a.t <= t < b.t`), `t` being STRICTLY
 * inside the track (binary search). The caller handles the edges.
 */
function bracketAt<P extends { t: number }>(points: readonly P[], t: number): { a: P; b: P } {
  let lo = 0
  let hi = points.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].t <= t) lo = mid
    else hi = mid
  }
  return { a: points[lo], b: points[hi] }
}

/**
 * positionAt returns a track's position at time `t` (frame index):
 * - null before the first sampled point;
 * - the last point held after the last sample;
 * - linear interpolation between two known samples (binary search);
 * - EXCEPT across a gap (`b.g > 0`): the position is held at the point that precedes it.
 */
export function positionAt(points: ReplayCutPoint[], t: number): XY | null {
  if (points.length === 0) return null
  const first = points[0]
  if (t <= first.t) return t < first.t ? null : { x: first.x, y: first.y }
  const last = points[points.length - 1]
  if (t >= last.t) return { x: last.x, y: last.y }

  const { a, b } = bracketAt(points, t)
  if (breaksLine(b)) return { x: a.x, y: a.y }
  const span = b.t - a.t
  const f = span === 0 ? 0 : (t - a.t) / span
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}

/**
 * inGapAt says whether frame `t` falls INSIDE a replication gap: strictly after the point that
 * precedes it and before the point (`g > 0`) that closes it. False on a point, before the life
 * and after its last point.
 */
export function inGapAt(points: readonly ReplayPoint[], t: number): boolean {
  if (points.length < 2 || t <= points[0].t || t >= points[points.length - 1].t) return false
  const { a, b } = bracketAt(points, t)
  return t > a.t && isGapPoint(b)
}

/**
 * trailAt returns the points of a track's trail in the window [t-window, t] (raw samples) plus
 * the head interpolated at `t`. A point that closes a gap RESTARTS the trail: no segment joins
 * the two sides of a film silence.
 */
export function trailAt(points: ReplayCutPoint[], t: number, windowFrames: number): XY[] {
  const start = t - windowFrames
  const out: XY[] = []
  for (const p of points) {
    if (p.t < start) continue
    if (p.t > t) break
    if (breaksLine(p)) out.length = 0
    out.push({ x: p.x, y: p.y })
  }
  const head = positionAt(points, t)
  if (head) {
    const tail = out[out.length - 1]
    if (!tail || tail.x !== head.x || tail.y !== head.y) out.push(head)
  }
  return out
}

/**
 * altitudeAt returns the interpolated Z of a track at time `t` (0 if the artifact has no Z),
 * held across a gap like the position.
 */
export function altitudeAt(points: ReplayCutPoint[], t: number): number | null {
  if (points.length === 0) return null
  const first = points[0]
  if (t <= first.t) return t < first.t ? null : (first.z ?? 0)
  const last = points[points.length - 1]
  if (t >= last.t) return last.z ?? 0

  const { a, b } = bracketAt(points, t)
  if (breaksLine(b)) return a.z ?? 0
  const span = b.t - a.t
  const f = span === 0 ? 0 : (t - a.t) / span
  return (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * f
}

/**
 * advanceFrame computes the next playback time; loops to 0 at the end of the replay.
 * `deltaFrames` can be fractional (real dt × speed).
 */
export function advanceFrame(t: number, deltaFrames: number, frameCount: number): number {
  if (frameCount <= 1) return 0
  const next = t + deltaFrames
  if (next >= frameCount - 1) return 0
  return next < 0 ? 0 : next
}

/**
 * worldToCanvas projects a world position (x,y) into a canvas rectangle (fit preserving the
 * ratio, centered, with margin `pad`). Y is INVERTED: the world has +Y up, the canvas +Y down.
 */
export function worldToCanvas(
  p: XY,
  bounds: ReplayBounds,
  width: number,
  height: number,
  pad: number,
): XY {
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6)
  const scale = Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh)
  const drawW = bw * scale
  const drawH = bh * scale
  const offsetX = (width - drawW) / 2
  const offsetY = (height - drawH) / 2
  return {
    x: offsetX + (p.x - bounds.minX) * scale,
    y: offsetY + (bounds.maxY - p.y) * scale,
  }
}

/**
 * usefulHeight — THE HEIGHT BEYOND WHICH ONE ADDS NO MORE MAP, BUT EMPTY SPACE.
 *
 * It answers a question the fixed height never had to ask: how far does the terrain benefit
 * from growing? `canvasScale` takes the SMALLEST of the two ratios (width/scene width,
 * height/scene height). Past the point where the width becomes the limiting factor, each
 * extra pixel of height enlarges nothing: it adds an empty band above and below the map.
 *
 * This ceiling is therefore PER MAP. A near-square map can occupy a lot of height in a wide
 * column; a very elongated map saturates much sooner. That is what the constant ceiling could
 * not express.
 */
export function usefulHeight(bounds: ReplayBounds, available: number, pad: number): number {
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6)
  return Math.max((available - 2 * pad) * (bh / bw) + 2 * pad, 2 * pad + 1)
}

/**
 * THE ZOOM STEPS, and why they are not continuous.
 *
 * Changing the framing makes the four static layers RE-BAKE (the ground and its ~45 000 cells
 * first). A continuous zoom — the wheel — would trigger one per notch, so dozens per gesture.
 * Steps make each change rare, predictable, and NAMEABLE on screen: "2x" reads, "1.37x" means
 * nothing to whoever is watching a match.
 */
export const ZOOM_LEVELS = [1, 1.5, 2, 3] as const
export type ZoomLevel = (typeof ZOOM_LEVELS)[number]

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/**
 * clampCenter — the center of the window, brought back where the window stays INSIDE the scene.
 *
 * Exported separately from `visibleBounds` because the zoom state needs it without wanting the
 * bounds: when the zoom is lowered, the current center can become illegal (a wider window no
 * longer fits as close to the edge) and it must be brought in BEFORE storing it — otherwise
 * the state keeps a value the display corrects in silence, and the two diverge.
 *
 * At zoom 1 the window equals the scene: the two bounds of the `clamp` meet, only one possible
 * position remains. The directional cross therefore disables itself, without anyone having to
 * write the rule "no panning at zoom 1".
 */
export function clampCenter(
  scene: ReplayBounds,
  zoom: number,
  cx: number,
  cy: number,
): { x: number; y: number } {
  const halfW = Math.max(scene.maxX - scene.minX, 0) / (2 * Math.max(zoom, 1))
  const halfH = Math.max(scene.maxY - scene.minY, 0) / (2 * Math.max(zoom, 1))
  return {
    x: clamp(cx, scene.minX + halfW, scene.maxX - halfW),
    y: clamp(cy, scene.minY + halfH, scene.maxY - halfH),
  }
}

/**
 * visibleBounds — THE VISIBLE WINDOW, and that is ALL the zoom changes.
 *
 * # WHY BY THE BOUNDS, AND NOT BY A SCALE
 *
 * The temptation was to add `{scale, panX, panY}` to the framing and apply them everywhere.
 * That would have touched `worldToCanvas`, `canvasScale`, the hover, the four layers and the
 * tooltips — and above all introduced TWO ways of stating where a world point falls, which
 * would have diverged at the first oversight.
 *
 * Yet the projection is entirely defined by the BOUNDS: `worldToCanvas` maps `bounds` onto
 * the canvas. Zooming is therefore shrinking the bounds; moving is translating them. Nothing
 * else moves — the hover reads the same projection as the drawing, it follows without a line.
 *
 * # WHAT THAT SETTLES FOR FREE
 *
 * The static layers bake from the framing: with shrunken bounds, they bake the WINDOW at the
 * screen's resolution. Their area therefore does NOT depend on the zoom level — the fear of a
 * memory that swells with the magnification is avoided by construction, and not by a
 * precaution that would have to be maintained.
 *
 * # THE ASPECT IS PRESERVED
 *
 * The two dimensions are divided by the SAME factor. Without that, `usefulHeight` (the
 * height ceiling computed per map) and the framing would contradict each other at every step:
 * the window would demand a shape the canvas cannot give it, and the map would float in empty
 * bands that change size at every notch.
 *
 * The vertical amplitude (`minZ`/`maxZ`) passes through unchanged: the zoom is planar, it says
 * nothing about the floors.
 */
export function visibleBounds(
  scene: ReplayBounds,
  zoom: number,
  cx: number,
  cy: number,
): ReplayBounds {
  const z = Math.max(zoom, 1)
  const halfW = Math.max(scene.maxX - scene.minX, 0) / (2 * z)
  const halfH = Math.max(scene.maxY - scene.minY, 0) / (2 * z)
  const c = clampCenter(scene, z, cx, cy)
  return {
    minX: c.x - halfW,
    maxX: c.x + halfW,
    minY: c.y - halfH,
    maxY: c.y + halfH,
    minZ: scene.minZ,
    maxZ: scene.maxZ,
  }
}

/** The center of the scene — the starting position of the framing, and the return-to-1x one. */
export function sceneCenter(scene: ReplayBounds): { x: number; y: number } {
  return { x: (scene.minX + scene.maxX) / 2, y: (scene.minY + scene.maxY) / 2 }
}

/** canvasScale = pixels per world unit for the same framing as worldToCanvas. */
export function canvasScale(
  bounds: ReplayBounds,
  width: number,
  height: number,
  pad: number,
): number {
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6)
  return Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh)
}

/**
 * sceneBounds frames the scene.
 *
 * WITH A RECONSTRUCTED FLOOR, THE FRAME IS THE PLAYED AREA. A map's structure covers ±250 m
 * (skybox, distant decor) where the players traverse 50: framing on it would reduce the
 * terrain to a stamp in the center of the screen. That is also the POC's framing.
 *
 * `hasMapImage` EXTENDS THIS SAME RULE TO THE MAP BACKGROUND, and the defect it fixed was
 * visible on screen (2026-08-26): when an image is laid, `ReplayCanvas` does NOT draw the
 * Forge props (they are the background's `else if`), but the union kept them in the frame's
 * denominator. The frame was therefore sized to INVISIBLE matter, and the map reduced to a
 * stamp in an empty canvas. A map image is a background just like a reconstructed floor: it
 * makes the props useless for the framing.
 *
 * WITHOUT A FLOOR NOR AN IMAGE, the Forge props become the sole background again, and they
 * overflow the traversed area: one then frames on the union, otherwise they would be cropped.
 */
export function sceneBounds(doc: ReplayDocumentReady, hasMapImage = false): ReplayBounds {
  if (hasMapImage || doc.structure?.length) return doc.bounds
  const g = doc.geometryBounds
  if (!g) return doc.bounds
  return {
    minX: Math.min(doc.bounds.minX, g.minX),
    minY: Math.min(doc.bounds.minY, g.minY),
    maxX: Math.max(doc.bounds.maxX, g.maxX),
    maxY: Math.max(doc.bounds.maxY, g.maxY),
    minZ: doc.bounds.minZ,
    maxZ: doc.bounds.maxZ,
  }
}

/**
 * framesPerSecond gives the "1×" playback rate: the replay then follows the match's real time
 * (frameIntervalMs = real duration of a frame). Without a time scale in the artifact, one
 * falls back on the historical rate (axis = record index).
 */
export function framesPerSecond(doc: ReplayDocumentReady): number {
  const interval = doc.frameIntervalMs ?? 0
  return interval > 0 ? 1000 / interval : FALLBACK_FPS
}

/** frameToMs converts a frame into milliseconds elapsed since the start of the replay. */
export function frameToMs(frame: number, doc: ReplayDocumentReady): number {
  const interval = doc.frameIntervalMs ?? 0
  return interval > 0 ? frame * interval : (frame / FALLBACK_FPS) * 1000
}

/** msToFrames converts a real duration (ms) into a number of frames. */
export function msToFrames(ms: number, doc: Pick<ReplayDocumentReady, 'frameIntervalMs'>): number {
  const interval = doc.frameIntervalMs ?? 0
  return interval > 0 ? ms / interval : (ms / 1000) * FALLBACK_FPS
}

/**
 * Opening a replay from a tactical link places itself THIS DELAY BEFORE the event: time to
 * see the action coming rather than arriving on the spot. Same value for both clocks.
 */
export const OPEN_BEFORE_EVENT_MS = 5000

/** What the replay route draws from a tactical link once the document is loaded. */
export interface TacticalOpenAtFrame {
  /** The frame at which to open the replay, or `null`: no link, malformed link, document
   *  not yet loaded, or match clock not established (see `showMissingOriginNotice`). */
  openAtFrame: number | null
  /** `true` when `clock: 'match'` asked for a conversion this document does not allow (no
   *  film origin, hence no match clock, see `matchClock`) — the route then displays a notice
   *  rather than opening on an approximate jump. */
  showMissingOriginNotice: boolean
}

/**
 * resolveTacticalOpenAtFrame — THE function the replay route calls for a tactical link
 * (`?t=&clock=`), from the URL's raw text to the frame ready for `ReplayCanvas.
 * openAtFrame`.
 *
 * THE `clock` KEY SAYS ON WHICH AXIS `t` IS EXPRESSED (same vocabulary as
 * `TacticalContribution.clock` on the Go side, `domain/tactical_cellule.go`):
 *   - `film`  (times, routes): the film axis, already the one `msToFrames` consumes;
 *   - `match` (deaths, frags, wins, isolations): the match axis. The conversion is THE
 *     replay's sole subtraction, `matchClock(doc).filmMsOfMatchMs` (`t − originMs`): no other.
 *     Without a film origin (`matchClock` returns `null`), no fallback to zero — the gap is an
 *     unknown of several seconds, and a wrong jump would not be distinguishable from an exact
 *     one: the `showMissingOriginNotice` notice says so.
 *
 * The opening instant is moved back by `OPEN_BEFORE_EVENT_MS`, floored at the zero frame.
 *
 * `search.t` IS A STRING (not a number): see the doc of `Route.validateSearch` in
 * `replay.tsx` — a numeric field in THIS route's search schema would poison the GLOBAL schema
 * that TanStack Router merges across all routes.
 *
 * `doc` ABSENT (document not yet loaded) returns `{ openAtFrame: null, showMissingOriginNotice:
 * false }` — NOT a notice: the notice is issued ONLY when the document is there and says
 * itself that it has no origin. Before that, the page is loading, not in a defect.
 */
export function resolveTacticalOpenAtFrame(
  search: { t?: string; clock?: 'match' | 'film' },
  doc: ReplayDocumentReady | undefined,
): TacticalOpenAtFrame {
  const none: TacticalOpenAtFrame = { openAtFrame: null, showMissingOriginNotice: false }
  if (search.t == null || !search.clock || !doc) return none
  const tMs = Number(search.t)
  if (!Number.isFinite(tMs) || tMs < 0) return none
  let filmMs = tMs
  if (search.clock === 'match') {
    // `filmMsOfMatchMs` does not read the match header: only the film origin counts here.
    const clock = matchClock(doc, null)
    if (!clock) return { openAtFrame: null, showMissingOriginNotice: true }
    filmMs = clock.filmMsOfMatchMs(tMs)
  }
  const openMs = Math.max(0, filmMs - OPEN_BEFORE_EVENT_MS)
  return { openAtFrame: Math.round(msToFrames(openMs, doc)), showMissingOriginNotice: false }
}

/**
 * formatClock formats a duration as `m:ss` (the replay's stopwatch). IT TRUNCATES, and that is
 * the convention of a player: "1:05" means "we are in the 66th second", not "we are at 66 s
 * rounded". Every visible surface of the replay shares it (clock, kill feed, timeline marks) —
 * guardrail `replayClockFormat.guard.test.ts`.
 *
 * WHAT THAT SHARING CHANGED ON SCREEN, and it is accepted (2026-09-06, review R1, finding C4 —
 * fifth exception of lot v2 D): the NATIVE TOOLTIP of the timeline marks
 * (`ui/ReplayTimelineTracks.tsx`, `title={m.clock}`) displayed a second MORE before this
 * lot, on roughly one mark out of two — it called the INSTANT formatter of `lib/formatters`,
 * which ROUNDS instead of truncating. The offset was not a display detail: the same death was
 * dated "1:06" in the tooltip and "1:05" in the feed, on the same screen. That is the
 * resolution of the P0-6 residue, not a regression.
 */
export function formatClock(ms: number): string {
  const total = Math.max(Math.floor(ms / 1000), 0)
  const sec = total % 60
  return `${Math.floor(total / 60)}:${sec < 10 ? '0' : ''}${sec}`
}

/** formatSeconds renders a short delay in seconds with one decimal (FR/EN decimal comma). */
export function formatSeconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1)} s`
}

/**
 * READING_FADE — a reading at the age floor keeps half its opacity: it fades, it does not
 * disappear. That is the `fade` passed to `freshness` by every card surface (vitals, weapons,
 * inventory), so that "old" reads the same everywhere.
 */
export const READING_FADE = 0.5

/**
 * trackWindow bounds a track's life on the time axis. The fields are omitempty on the
 * artifact side: startFrame absent = 0, endFrame absent = t of the last point.
 */
export function trackWindow(track: ReplayTrackReady): { start: number; end: number } {
  const last = track.points[track.points.length - 1]
  return {
    start: track.startFrame ?? 0,
    end: track.endFrame ?? (last ? last.t : 0),
  }
}

/** isAliveAt indicates whether the track's life covers the frame (otherwise: draw nothing). */
export function isAliveAt(track: ReplayTrackReady, frame: number): boolean {
  const w = trackWindow(track)
  return frame >= w.start && frame <= w.end
}

/**
 * HeldReading — a film measurement and ITS AGE, in frames.
 *
 * WHY THE AGE TRAVELS WITH THE VALUE. The stream is differential: the film re-transmits a
 * quantity only when it CHANGES. What is on screen between two transmissions is therefore the
 * LAST known reading, not the state of the instant. Displaying one as the other without
 * saying so produced a real defect, observed at 1:06 on a player whose displayed state dated
 * from 9.7 s. The measurement that grounded the fix says it is not a rare case: across the
 * 21 899 cards of a match, the median reading age is 8.4 s and only 7.1 % are under one
 * second. An old measurement must therefore PALE, never disappear nor pass itself off as
 * fresh.
 */
export interface HeldReading {
  value: number
  /** Age of the reading, in frames. 0 = measured at that very frame. */
  age: number
}

/**
 * heldReading returns the last value transmitted at the latest at `frame`, with its age, or
 * null if none exists in the `maxAge` window.
 *
 * `pick` must return `undefined` for "not transmitted". NOTE: `0` is a VALUE — a null shield
 * is the most useful piece of information on the field. Testing truthiness instead of
 * `undefined` would erase precisely the case that counts.
 */
export function heldReading(
  points: ReplayPoint[],
  frame: number,
  pick: (p: ReplayPoint) => number | undefined,
  maxAge: number,
): HeldReading | null {
  let i = lastIndexAt(points, frame)
  while (i >= 0) {
    const p = points[i]
    const age = frame - p.t
    if (age > maxAge) return null
    const v = pick(p)
    if (v !== undefined) return { value: v, age }
    i--
  }
  return null
}

/**
 * lastIndexAt returns the index of the last point timestamped <= t (-1 if none), by bisection.
 *
 * SIGNATURE WIDENED ON 2026-09-03 (schema 31): it reads ONLY `t`, and a vehicle occupant's
 * aim series (`ReplayVehicleAim`, without `x`/`y`) has exactly the same need. Widening it
 * avoids a second bisection copied into `vehiclesLayer.ts` (rule "≤ 2 copies"); a
 * `ReplayPoint[]` stays assignable as-is.
 */
export function lastIndexAt(points: readonly { t: number }[], t: number): number {
  if (points.length === 0 || t < points[0].t) return -1
  let lo = 0
  let hi = points.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (points[mid].t <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/**
 * freshness converts an age into an opacity factor in [1 - fade, 1]: full when the
 * measurement just arrived, attenuated when it dates. It is the same gradation everywhere in
 * the replay — aim cone, shield, inventory — so that "old" always reads the same way.
 *
 * The age can be NEGATIVE (reading of a future keyframe, see loadoutAt): a reading far away
 * in time is a far reading, whatever the direction — the dimming applies to the absolute
 * value.
 */
export function freshness(age: number, hold: number, fade: number): number {
  if (hold <= 0) return 1
  return 1 - fade * Math.min(1, Math.abs(age) / hold)
}

/** altitudeRatio normalizes a Z into [0,1] over the known vertical amplitude (0.5 if flat). */
export function altitudeRatio(z: number, minZ: number, maxZ: number): number {
  const span = maxZ - minZ
  if (!(span > 1e-6)) return 0.5
  const r = (z - minZ) / span
  return r < 0 ? 0 : r > 1 ? 1 : r
}

/** floorOf returns the altitude-band index (0 = low) for a given Z. */
export function floorOf(z: number, minZ: number, maxZ: number, bands = FLOOR_BANDS): number {
  const idx = Math.floor(altitudeRatio(z, minZ, maxZ) * bands)
  return idx >= bands ? bands - 1 : idx
}

/**
 * footprint returns the 4 WORLD corners of a Forge prop's footprint (rectangle centered on
 * (x,y), of size (dx,dy), rotated `yaw` degrees around the vertical). Returns an empty list
 * if the object has no footprint: the render then falls to a plain point.
 */
export function footprint(o: ReplayMapObject): XY[] {
  const dx = o.dx ?? 0
  const dy = o.dy ?? 0
  if (dx <= 0 || dy <= 0) return []
  const rad = ((o.yaw ?? 0) * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const hx = dx / 2
  const hy = dy / 2
  return [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ].map(([ux, uy]) => ({
    x: o.x + ux * cos - uy * sin,
    y: o.y + ux * sin + uy * cos,
  }))
}

/**
 * canvasToWorld — THE EXACT INVERSE of `worldToCanvas`.
 *
 * It exists for ONE reason: to know which world point lies under the pointer, so the wheel
 * zooms TOWARD the cursor. Without it, the wheel could only zoom toward the center of the
 * window — that is, move under the mouse what one was aiming at with it.
 *
 * It takes the `worldToCanvas` formula in reverse, term for term, and the round-trip test is
 * what guarantees they will not diverge: two projections written separately always end up
 * contradicting each other by a half-pixel, and a half-pixel of drift per wheel notch becomes
 * a plain offset in five notches.
 */
export function canvasToWorld(
  c: XY,
  bounds: ReplayBounds,
  width: number,
  height: number,
  pad: number,
): XY {
  const bw = Math.max(bounds.maxX - bounds.minX, 1e-6)
  const bh = Math.max(bounds.maxY - bounds.minY, 1e-6)
  const scale = Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh)
  if (!(scale > 0)) return { x: bounds.minX, y: bounds.maxY }
  const offsetX = (width - bw * scale) / 2
  const offsetY = (height - bh * scale) / 2
  return {
    x: bounds.minX + (c.x - offsetX) / scale,
    y: bounds.maxY - (c.y - offsetY) / scale,
  }
}

/**
 * zoomTowards — the center that keeps a world point STILL on screen when the zoom changes.
 *
 * The formula fits in one line, and it is provable: a point `p` is at the same RELATIVE
 * position in the window before and after if its offset from the center is divided by the
 * same factor as the window itself. Hence `c' = p + (c - p) x (zoomBefore / zoomAfter)`.
 *
 * That is what makes a wheel "grab" the place one is aiming at instead of chasing it away.
 */
export function zoomTowards(
  center: XY,
  point: XY,
  fromZoom: number,
  toZoom: number,
): XY {
  const k = Math.max(fromZoom, 1) / Math.max(toZoom, 1)
  return { x: point.x + (center.x - point.x) * k, y: point.y + (center.y - point.y) * k }
}

/**
 * layerOffset — WHERE TO PLACE AN ALREADY-BAKED LAYER when the framing has moved since its bake.
 *
 * # WHY IT EXISTS
 *
 * During a drag, the framing changes with every pointer movement. Re-baking the static layers
 * at that rate is out of the question — the reconstructed ground makes ~45 000 cells. But a
 * drag is a PURE TRANSLATION: the same image, placed elsewhere. So it suffices to copy the
 * baked layer with an offset, and it is EXACT — not an approximation one would correct
 * after the fact.
 *
 * # HOW
 *
 * Pixel (0,0) of the baked layer designates a world point, the one ITS projection placed
 * there. One asks where that same point falls in the CURRENT projection: that is the offset.
 * The two projections share their scale as long as the zoom has not changed (same window
 * dimensions), so the result is a translation and nothing else.
 *
 * On a ZOOM change, the scale differs and an offset would no longer suffice: that is why the
 * caller freezes the bake only during a drag, never during a zoom.
 */
export function layerOffset(
  cooked: { bounds: ReplayBounds; width: number; height: number; pad: number } | null,
  view: { bounds: ReplayBounds; width: number; height: number; pad: number },
): XY {
  if (!cooked) return { x: 0, y: 0 }
  const p = canvasToWorld({ x: 0, y: 0 }, cooked.bounds, cooked.width, cooked.height, cooked.pad)
  return worldToCanvas(p, view.bounds, view.width, view.height, view.pad)
}

/**
 * frameBounds — THE SCENE ENLARGED TO THE SHAPE OF THE CANVAS.
 *
 * # THE DEFECT IT FIXES (user feedback of 2026-09-03)
 *
 * "When I zoom, it is cropped, even though the replay block is big enough." (original French:
 * « Quand je zoome c'est croppé alors que le bloc du replay est assez grand. »)
 *
 * The canvas hugged the ratio of the SCENE. When the height is bounded by the screen — the
 * common case — that canvas is then narrower than the block, and there are empty margins left
 * and right. Zooming, the image enlarges in that narrow canvas and is cut at its edges, while
 * the space available right next to it serves nothing.
 *
 * # THE FIX
 *
 * The canvas takes the WHOLE width of the block, and it is the visible window that adopts the
 * canvas's shape — enlarged on the non-limiting axis until it contains the scene. Yesterday's
 * empty bands become world space: at magnification 1 the render is the same, but as soon as
 * one zooms, the window shrinks from that frame and fills the whole canvas.
 *
 * # WHY THE FRAME, AND NOT THE SCENE, IS THE REFERENCE OF THE ZOOM
 *
 * Everything that bounds the framing — `clampCenter`, `visibleBounds` — must work on THIS
 * rectangle. Bounding on the scene would let the panning stop before the edges of what one
 * sees, and the zoom would restart from a shape that is not the canvas's: the window would
 * become narrower than it again, and the reframing would reappear at the first notch.
 */
export function frameBounds(
  scene: ReplayBounds,
  width: number,
  height: number,
  pad: number,
): ReplayBounds {
  const bw = Math.max(scene.maxX - scene.minX, 1e-6)
  const bh = Math.max(scene.maxY - scene.minY, 1e-6)
  const cw = Math.max(width - 2 * pad, 1)
  const ch = Math.max(height - 2 * pad, 1)
  // The meters per pixel imposed by the LIMITING axis: it is the one that decides the scale,
  // and the other axis receives the surplus as world space rather than as an empty band.
  const mpp = Math.max(bw / cw, bh / ch)
  const halfW = (cw * mpp) / 2
  const halfH = (ch * mpp) / 2
  const cx = (scene.minX + scene.maxX) / 2
  const cy = (scene.minY + scene.maxY) / 2
  return {
    minX: cx - halfW,
    maxX: cx + halfW,
    minY: cy - halfH,
    maxY: cy + halfH,
    minZ: scene.minZ,
    maxZ: scene.maxZ,
  }
}
