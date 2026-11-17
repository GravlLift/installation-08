// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * replayMarkers.ts — THE PLAYER ON THE MAP: trail, floor marker, aim cone, appearance and
 * death.
 *
 * WHAT THIS LAYER NO LONGER DRAWS. A SHIELD gauge sat above each marker; it was removed on
 * 2026-08-15 at the user's request — "je veux pas ces barres horizontales au dessus des
 * points de joueurs" (I do not want these horizontal bars above the player points) — and
 * this request replaces the decision of 2026-08-13 that had made it permanent. The `sh`
 * field keeps traveling: it is the PLAYER CARDS that read it (rosterLogic.ts). What is
 * refused is the drawing on the map, not the measurement.
 *
 * A trace = ONE LIFE, never a player: the biped slot is reassigned at each respawn. The
 * three instants of a life are therefore read separately — it OPENS (ring), it DUR (marker
 * + trail), it CLOSES (cross). Without these marks, a life that disappears and another that
 * begins two meters away are indistinguishable.
 *
 * EVERYTHING ADDRESSED TO THE EYE IS AT THE SCALE OF THE SCREEN, not the canvas. The canvas
 * is rendered at the device density: a radius declared in canvas pixels would appear twice
 * as small on a high-density screen. The positions, for their part, belong to the WORLD and
 * do not touch it. That is the distinction the POC had to introduce after noticing that
 * "enlarged" points stayed invisible.
 *
 * WHAT EACH MARKER CARRIES SINCE 2026-08-16 (dressing plan, decisions D1-D5): the TEAM
 * color of its owner (never a tint per life), its identity SHAPE (diamond for a friend,
 * outlined disk for the player of the page) and its NAME written below (replayLabels.ts).
 * The stroke that came out of the point — the axis of the cone — was REMOVED at the user's
 * request ("supprimer le bâton qui sort de ces points" (remove the stick that comes out of
 * these points)): the gradient cone already says the direction of the gaze.
 *
 * No color literal: the team tints arrive resolved from the tokens, the readability inks
 * from the theme (cf. canvasInk.ts).
 */
import type { PlayerMarkKind } from '../../../lib/replay/playerMarks'
import { drawAimCone } from './replayAimCone'
import { CORE_RADIUS, OUTLINE_PAD } from '@/lib/replay/screenSizes'
import { drawFloorRings, floorInRange, FLOOR_RING_WIDTH, floorRingRadius } from './floorRings'
import { drawNameLabel } from './replayLabels'
import type { ReplayTrackReady } from '../../../lib/replay/replayNormalize'

import {
  altitudeAt,
  inGapAt,
  isAliveAt,
  positionAt,
  trackWindow,
  trailAt,
  type XY,
} from '../../../lib/replay/replayLogic'
import { type CanvasView, projectTo } from '../model/replayView'
import { edgeMarkFor, OFFSCREEN_MARGIN_PX } from '../model/edgeClamp'
import { drawOffscreenChevron, drawOffscreenLabel } from './offscreenChevron'

// --- Durations, in frames, converted by the caller from real time ---------------------

/**
 * Time settings of the layer, all expressed in frames of the replay grid.
 * The reference values come from the POC, where they were tuned on screen:
 * trail 7 s, aim held 5 s (aim coverage goes from 43.6% to 93.5% of game time),
 * appearance 0.8 s. Death, however, was LENGTHENED since: 2.5 s instead of the
 * 1.5 s of the POC, where the cross passed unnoticed in accelerated reading (cf. TIMING_MS in
 * `useReplayTiming.ts`, sole source of the declared durations).
 */
export interface MarkerTiming {
  trail: number
  aimHold: number
  death: number
  spawn: number
}

// --- Render constants (SCREEN pixels, unless stated) ------------------------------------

/**
 * THE TRAIL LIGHTENS TOWARD THE PAST. A single stroke at constant opacity said "the player
 * went through there" without saying IN WHICH DIRECTION; the alpha that rises toward the head
 * gives the direction of the movement without adding the slightest arrow. The polyline is
 * therefore drawn segment by segment, each with its opacity.
 */
const TRAIL_WIDTH = 1.6
const TRAIL_ALPHA_TAIL = 0.08
const TRAIL_ALPHA_HEAD = 0.63

/**
 * THE SIZES AND THE STYLE OF THE MARKER FOLLOW THE BOARD VALIDATED ON 2026-08-16 (item A1),
 * whose values are transcribed at §1bis of the dressing plan — user verdict:
 * "Parfait. Je veux exactement ce style pour les points, la croix de mort et la traînée."
 * (Perfect. I want exactly this style for the points, the death cross and the trail.)
 * What the board changes compared to the POC: the point shrinks (4.6 -> 3.4), the diffuse halo
 * DISAPPEARS, and the floor stops being a trace color to become a thin ring in the ink of the
 * theme.
 */
const CORE_PER_FLOOR = 0.7
// The floor rings (one per floor above the ground, first radius FIXED and detached from the
// point) live in `floorRings.ts` since 2026-09-18: the mode objectives speak the same
// language, and a single loop traces them.
const OUTLINE_ALPHA = 0.62
/**
 * THE PLAYER OF THE PAGE (shape 'ring') — DOUBLE OUTLINE AND HALO since 2026-08-18.
 *
 * WHAT THE RETURN ASKS FOR: "avoir l'icône du joueur actif qui se démarque de tous les
 * autres aussi (j'aurais bien aimé du vert mais pour l'accessibilité je sais pas si ça peut
 * le faire)" (have the icon of the active player stand out from all the others too (I would
 * have liked green but for accessibility I don't know if it can work)). The answer holds in
 * one rule: THE COLOR NEVER CARRIES ALONE. The marker of the player of the page was already
 * outlined by ONE ring; it now carries TWO, plus a diffuse halo, and it is this SHAPE that
 * distinguishes it — a reader who does not see the tint always sees the only point on the
 * map with two rings. The color (`selfInk`, token `success`) comes ON TOP, on the outline and
 * the halo; the CORE keeps the TEAM color, which says the side.
 *
 * THE HALO IS BACK HERE, AND ONLY HERE. It had been removed from ALL the markers on
 * 16/08 ("la lueur diffuse doublait l'emprise et empâtait la carte" (the diffuse glow doubled
 * the footprint and blurred the map)) — on a single point of the map, it does not blur it,
 * it designates it.
 */
const SELF_RING_WIDTH = 1.5
const SELF_RING_GAP = 1.6
/** Gap between the two identity rings, in screen pixels. */
const SELF_RING_GAP_2 = 2.4
/** The halo: a diffuse disk placed under the marker, at the radius of the second ring. */
const SELF_HALO_PAD = 2.2
const SELF_HALO_ALPHA = 0.22

/**
 * DEATH CROSS — FIXED half-size that fades (it no longer grows, cf. §1bis).
 *
 * SMALLER AND THICKER since 2026-08-18 (A1): "les croix de mort plus petites, plus épaisses,
 * toujours rouges, et qui persistent plus longtemps" (death crosses smaller, thicker, always
 * red, and lasting longer). At 5 px of half-size for 1.6 px of stroke, the cross had the
 * footprint of a living marker and the weight of a trail stroke — it looked wide and pale.
 * At 3.6 for 2.6 it occupies half the surface and strikes twice as hard: it is a mark, not a
 * player.
 */
const DEATH_RADIUS = 3.6
const DEATH_WIDTH = 2.6
const DEATH_ALPHA = 0.9

/**
 * THE PAWN DURING A REPLICATION GAP (`Point.g`, user decision Q14 of 2026-09-23: "tenu,
 * pâli" (held, faded)). The position is held at the last known point (`positionAt`) and the
 * pawn is drawn at this fraction of its opacity: it says "we no longer know where it is
 * since", not "it is there". No aim cone (the aim is not replicated either) nor floor rings.
 */
const GAP_ALPHA = 0.35
const SPAWN_RADIUS = 2
const SPAWN_GROWTH = 12
const SPAWN_WIDTH = 1.2
const SPAWN_ALPHA = 0.8
/**
 * Style of the layer: what a LIFE borrows from its OWNER, plus the inks of the theme.
 *
 * EVERYTHING IS READ BY SLOT AND BY FRAME, never by trace index nor by a value frozen for
 * the whole match. The slot is the key of a life; the owner of the life that occupies the
 * slot AT THIS FRAME carries their team color, their identity mark and their name
 * (rosterLogic.ts) — a biped slot being reassigned between rounds, the frame is essential to
 * not show the player of ANOTHER round. A slot WITHOUT an owner at the frame returns `null`
 * for the color, and the layer does NOT draw it: cameras, end-of-game spectators (2026-08-20).
 * The mark and the name, however, can be missing on a life that is drawn — it then comes out
 * without label nor mark, not without marker.
 */
export interface MarkerStyle {
  /** Team color of the owner of the slot at the frame. `null` = draw nothing. */
  colorOfSlot: (slot: number, frame: number) => string | null
  /** Ink that contrasts with the page in both themes: rim, ring of the player. */
  ink: string
  frame: number
  timing: MarkerTiming
  z: { min: number; max: number }
  /** Canvas density: everything addressed to the eye is multiplied by this factor. */
  k: number
  showAim: boolean
  /** Identity mark of the owner of the slot at the frame: it decides the SHAPE of the marker. */
  markOfSlot: (slot: number, frame: number) => PlayerMarkKind | undefined
  /** Name to write under the marker; `null` = slot without owner at the frame, hence no label. */
  nameOfSlot: (slot: number, frame: number) => string | null
  /** Name layer ("Names" button, lit by default): a BTB must be able to turn it off. */
  /** TRAIL layer ("Trail" button, lit by default) — return of 2026-08-18. */
  showTrail: boolean
  /** Ink of the DOUBLE OUTLINE and the halo of the player of the page (token `success`, cf. useReplayInks). */
  selfInk: string
  /**
   * Ink of the DEATH CROSS — token `destructive`, the same as the death effects of the
   * events layer (cf. useReplayInks). "toujours rouges" (always red) (A1, 2026-08-18): a
   * death no longer says the side of the one who dies, it says one is dead. The side stays
   * carried by the trail that just faded, by the card and by the feed.
   */
  deathInk: string
  /** Ink of the OUTLINE of the names — dark in both themes (cf. replayLabels.ts). */
  labelStroke: string
  /**
   * EMBARKED PAWN (vehicle lot, 2026-09-02, user decision): true when the slot is aboard a
   * vehicle at this frame — an OCCUPATION EPISODE covers `frame` (`VehicleRide`,
   * `vehiclesLayer.buildEmbarkedPredicate`). The biped no longer replicates its position
   * during the episode (the stream is interrupted, cf. `document_vehicles.go`): the pawn
   * frozen at the embarkation point WOULD BE INVENTED if it were still drawn — the tinted
   * vehicle now carries the information, and its name is reported on the vehicle (stacked,
   * driver first). Absent = unchanged behavior (no vehicle in the document, or layer
   * disabled).
   *
   * REMOVES EVERYTHING — marker, trail, death cross — NOT ONLY THE MARKER: the trail would
   * otherwise read a movement the film does not show, and a death aboard (rare) would resume
   * at the embarkation point rather than at the exit.
   */
  embarkedAtSlot?: (slot: number, frame: number) => boolean
  /**
   * THE RULE OF THE PAWN (user, 2026-10-21): true when the owner of the life of the slot
   * (resolved at `ownerFrame`) occupies a card at `frame` (`seatLogic.SeatedIndex`). False:
   * no marker, no trail, no cone, no name, no death cross — a revived bot has no pawn any
   * more, even when the film still gives it lives. `ownerFrame` is the frame BOUNDED to the
   * window of the life (that of the color), `frame` the frame read: a cross survives its
   * life, the card is read at the frame read. Absent = everything is drawn (callers without
   * roster).
   */
  seatedAtSlot?: (slot: number, ownerFrame: number, frame: number) => boolean
  /**
   * OFF-SCREEN BOUNDING (off-screen squad plan, workstream B, decision D2, 2026-09-10):
   * the text of the label of a player outside the window — name AND distance to their real
   * position. RESOLVED BY THE CALLER (`REPLAY_TEXT[locale].offscreenMarkerFmt`), like every
   * UI string of this feature (color-tokens/i18n rule): this layer knows no language, it
   ONLY composes the geometry and places the text it is given.
   */
  offscreenLabelOf: (name: string, meters: number) => string
}

/**
 * The SHAPE says the identity, the color says the side (decision D5): a friend is located
 * without reading their name, the one being watched as well, and neither of the two marks
 * touches the color that already carries the team.
 *
 * "THE ONE BEING WATCHED" AND NO LONGER "THE PLAYER OF THE PAGE" (2026-09-06, decision 13
 * of the "timeline, point of view" plan): the outlined disk follows the POINT OF VIEW, which
 * equals the player of the page by default. The table of marks is built by `buildPlayerMarks`,
 * to whom the page now passes this point of view — this layer still only reads the mark, not
 * the scoreboard.
 */
export type MarkerShape = 'circle' | 'diamond' | 'ring'

/** shapeOfMark: friend = diamond, the one being watched = outlined disk, everyone = disk. */
function shapeOfMark(mark: PlayerMarkKind | undefined): MarkerShape {
  if (mark === 'friend') return 'diamond'
  if (mark === 'me') return 'ring'
  return 'circle'
}

/**
 * drawTracksLayer draws each life at the current frame: those that live, and those that
 * just closed (the cross survives 2.5 s after the life it ends).
 */
export function drawTracksLayer(
  ctx: CanvasRenderingContext2D,
  tracks: ReplayTrackReady[],
  view: CanvasView,
  style: MarkerStyle,
): void {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  tracks.forEach((track) => {
    // EMBARKED PAWN: nothing is drawn for this slot at this frame — no marker, no trail,
    // no death cross. The vehicle that carries it (vehiclesLayer.ts) displays the
    // information in its place. Checked FIRST, before any color resolution: an embarked
    // slot stays "alive" on the data side (its biped is not dead), the death cross branch
    // must therefore never substitute for it.
    if (style.embarkedAtSlot?.(track.slot, style.frame)) return
    // The color is that of THE OWNER OF THIS LIFE: we therefore resolve the identity at a
    // frame BOUNDED to the window of the life. Alive, that is the current frame; in death
    // cross, that is the end of the life (the current frame can be beyond it, where the slot
    // is free or already taken over by ANOTHER life — resolving there would erase the cross
    // or lend it another player). The lives of a slot being disjoint, a frame in [start,
    // end] designates THIS life without ambiguity.
    const w = trackWindow(track)
    const at = Math.max(w.start, Math.min(style.frame, w.end))
    const color = style.colorOfSlot(track.slot, at)
    if (!color) return
    if (style.seatedAtSlot && !style.seatedAtSlot(track.slot, at, style.frame)) return
    if (!isAliveAt(track, style.frame)) {
      // The color of the slot stays the GATE (a life without color is not drawn), but the
      // cross no longer carries it: it is red (cf. `deathInk`).
      drawDeathMark(ctx, track, view, style)
      return
    }
    drawLivingTrack(ctx, track, view, style, color)
  })
  ctx.globalAlpha = 1
}

/**
 * drawDeathMark marks the place of the last transmitted position during `timing.death`,
 * then nothing: the player has disappeared until their respawn, which is ANOTHER life.
 *
 * OUTSIDE THE WINDOW (workstream B, decision D6, 2026-09-10): the X cross is replaced by the
 * ARROW, clamped to the margin, at the SAME fade computation — but WITHOUT name nor
 * distance. The cross only lives 2.5 s and already fades; its position at the edge says the
 * direction, one more label would add a barely read text (D6).
 */
function drawDeathMark(
  ctx: CanvasRenderingContext2D,
  track: ReplayTrackReady,
  view: CanvasView,
  style: MarkerStyle,
): void {
  const age = style.frame - trackWindow(track).end
  if (age < 0 || age > style.timing.death) return
  const last = track.points[track.points.length - 1]
  if (!last) return
  const fade = 1 - age / style.timing.death
  const mark = edgeMarkFor(last, view, OFFSCREEN_MARGIN_PX, style.k)
  if (mark) {
    ctx.globalAlpha = DEATH_ALPHA * fade
    drawOffscreenChevron(ctx, mark.at, mark.angle, style.k, style.deathInk)
    ctx.globalAlpha = 1
    return
  }
  const c = project(last, view)
  // THE CROSS DOES NOT GROW (board of 2026-08-16): a swelling cross would draw the eye to an
  // already past event. It keeps its size and fades.
  const r = DEATH_RADIUS * style.k
  // ALWAYS RED (A1, 2026-08-18): the team color of the deceased no longer passes here.
  ctx.strokeStyle = style.deathInk
  ctx.globalAlpha = DEATH_ALPHA * fade
  ctx.lineWidth = DEATH_WIDTH * style.k
  ctx.beginPath()
  ctx.moveTo(c.x - r, c.y - r)
  ctx.lineTo(c.x + r, c.y + r)
  ctx.moveTo(c.x + r, c.y - r)
  ctx.lineTo(c.x - r, c.y + r)
  ctx.stroke()
  ctx.globalAlpha = 1
}

/**
 * drawLivingTrack: trail, cone, appearance, floor marker.
 *
 * OUTSIDE THE WINDOW (workstream B, decision D2, 2026-09-10): nothing of all that is drawn
 * any more — only the ARROW, clamped to the margin, oriented toward the real position, in the
 * team color, with the name AND the distance. A trail, a cone or a floor ring traced at the
 * margin would designate a place the player does not occupy: the arrow entirely replaces the
 * marker, it does not add to it (same logic as the embarked pawn, just above).
 */
function drawLivingTrack(
  ctx: CanvasRenderingContext2D,
  track: ReplayTrackReady,
  view: CanvasView,
  style: MarkerStyle,
  color: string,
): void {
  const head = positionAt(track.points, style.frame)
  if (!head) return
  const mark = edgeMarkFor(head, view, OFFSCREEN_MARGIN_PX, style.k)
  if (mark) {
    drawOffscreenChevron(ctx, mark.at, mark.angle, style.k, color)
    const name = style.nameOfSlot(track.slot, style.frame)
    if (name) {
      const text = style.offscreenLabelOf(name, mark.distanceM)
      drawOffscreenLabel(ctx, mark.at, mark.angle, text, { k: style.k, labelStroke: style.labelStroke }, color)
    }
    return
  }
  const c = project(head, view)
  const fl = floorIndex(track, style)
  // IN A GAP, the pawn is held (`positionAt`) and FADED, without cone (cf. `GAP_ALPHA`).
  const alpha = inGapAt(track.points, style.frame) ? GAP_ALPHA : 1

  if (style.showTrail) drawTrail(ctx, track, view, style, color)
  if (style.showAim && alpha === 1) drawAimCone(ctx, track, c, style, color)
  drawSpawnRing(ctx, track, c, style, color)
  // Life IN PROGRESS: the current frame is in its window, it therefore designates the owner
  // of THIS life (the lives of a slot are disjoint).
  const shape = shapeOfMark(style.markOfSlot(track.slot, style.frame))
  drawMarker(ctx, c, style, color, fl, shape, alpha)
  // THE NAME UNDER THE POINT, never beside a death cross: the line above is reached only
  // for a life IN PROGRESS (drawDeathMark returns before).
  const name = style.nameOfSlot(track.slot, style.frame)
  if (name) drawNameLabel(ctx, c, name, style, color, markerEdge(fl, style.k, shape))
}

/**
 * markerEdge: distance from the center to the OUTER edge of everything the marker draws, in
 * screen pixels — it is UNDER this edge that the name is placed (replayLabels.ts).
 *
 * The edge is not always that of the rim: above the ground, the floor ring is placed at a
 * FIXED radius (6.5) that exceeds the disk, and the player of the page additionally carries
 * their identity ring. Taking the maximum of the three is the only way to be sure that the
 * label does not overlap any stroke.
 */
function markerEdge(fl: number, k: number, shape: MarkerShape): number {
  const outline = CORE_RADIUS + CORE_PER_FLOOR * fl + OUTLINE_PAD
  const ring = fl > 0 ? floorRingRadius(fl) + FLOOR_RING_WIDTH / 2 : 0
  const self = shape === 'ring' ? selfRingRadius2(fl) + SELF_HALO_PAD : 0
  return Math.max(outline, ring, self) * k
}

/** selfRingRadius: radius of the FIRST identity ring of the player of the page (shape 'ring'). */
function selfRingRadius(fl: number): number {
  return CORE_RADIUS + CORE_PER_FLOOR * fl + OUTLINE_PAD + SELF_RING_GAP
}

/** selfRingRadius2: radius of the SECOND ring — it is the one that makes the "double outline". */
function selfRingRadius2(fl: number): number {
  return selfRingRadius(fl) + SELF_RING_GAP_2
}

/**
 * drawTrail: the polyline of the 7 s that elapsed, drawn SEGMENT BY SEGMENT.
 *
 * A single `stroke` at constant opacity would cost less, but it would not say the DIRECTION
 * of the displacement. The opacity rises linearly from the tail (0.08 — almost erased) to
 * the head (0.63): the most visible trace is always that of the instant.
 */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  track: ReplayTrackReady,
  view: CanvasView,
  style: MarkerStyle,
  color: string,
): void {
  const trail = trailAt(track.points, style.frame, style.timing.trail)
  if (trail.length < 2) return
  const segments = trail.length - 1
  const span = TRAIL_ALPHA_HEAD - TRAIL_ALPHA_TAIL
  ctx.strokeStyle = color
  ctx.lineWidth = TRAIL_WIDTH * style.k
  let from = project(trail[0], view)
  for (let i = 1; i < trail.length; i++) {
    const to = project(trail[i], view)
    ctx.globalAlpha = TRAIL_ALPHA_TAIL + (span * i) / segments
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.stroke()
    from = to
  }
  ctx.globalAlpha = 1
}

/** drawSpawnRing: the ring that opens at the first instant of the life. */
function drawSpawnRing(
  ctx: CanvasRenderingContext2D,
  track: ReplayTrackReady,
  c: XY,
  style: MarkerStyle,
  color: string,
): void {
  const age = style.frame - trackWindow(track).start
  if (age < 0 || age > style.timing.spawn) return
  const f = 1 - age / style.timing.spawn
  ctx.beginPath()
  ctx.arc(c.x, c.y, (SPAWN_RADIUS + SPAWN_GROWTH * (1 - f)) * style.k, 0, Math.PI * 2)
  ctx.strokeStyle = color
  ctx.globalAlpha = SPAWN_ALPHA * f
  ctx.lineWidth = SPAWN_WIDTH * style.k
  ctx.stroke()
  ctx.globalAlpha = 1
}

/**
 * drawMarker draws the player: floor rings, rim, core — and its SHAPE says its identity
 * (disk, diamond for a friend, outlined disk for the player of the page).
 *
 * THERE IS NO HALO ANYMORE (board of 2026-08-16): the diffuse glow under each point doubled
 * the footprint of the marker and blurred the map as soon as a name was written below it.
 * The dark rim is enough to detach a colored point from a background that runs from white to
 * black.
 *
 * THE FLOOR IS READ BY CONCENTRIC RINGS, never by an offset of the marker: in top view,
 * moving a point to the top of the screen would mean "further north" and would distort the
 * position. Altitude is a step, not a gradient — the histogram of z shows sharp peaks, the
 * map has three levels of play.
 *
 * THE FLOOR RING TAKES THE COLOR OF THE PAWN since 2026-08-18 (A1: "le cercle d'altitude à
 * la couleur du pion du joueur" (the altitude circle in the color of the pawn of the player)).
 * It was in the ink of the theme, so as not to make the color say two things; on screen,
 * this neutrality detached it from its point and, on a populated three-floor map, one read
 * orphan rings. The color still only says the side — it is the NUMBER of rings that says the
 * height, and it alone.
 *
 * THE DIAMOND HAS THE SAME CIRCUMSCRIBED RADIUS AS THE DISK: the shape changes, the size
 * does not — otherwise a friend would appear closer or bigger than their teammates.
 */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  c: XY,
  style: MarkerStyle,
  color: string,
  fl: number,
  shape: MarkerShape,
  /** Opacity fraction of the pawn: 1, or `GAP_ALPHA` during a replication gap. */
  alpha = 1,
): void {
  const core = (CORE_RADIUS + CORE_PER_FLOOR * fl) * style.k

  // THE HALO FIRST, under everything else: it is a glow, not a stroke.
  if (shape === 'ring') drawSelfHalo(ctx, c, style, fl, alpha)

  if (alpha === 1) drawFloorRings(ctx, c, fl, color, { k: style.k })

  ctx.globalAlpha = OUTLINE_ALPHA * alpha
  ctx.fillStyle = style.ink
  corePath(ctx, c, core + OUTLINE_PAD * style.k, shape)
  ctx.fill()

  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  corePath(ctx, c, core, shape)
  ctx.fill()
  ctx.globalAlpha = 1

  if (shape === 'ring') drawSelfRings(ctx, c, style, fl, alpha)
}

/**
 * drawSelfRings — THE TWO RINGS of the player of the page, in `selfInk`.
 *
 * TWO, NOT ONE: it is the double outline that carries the identity when the color cannot
 * (cf. the note on SELF_RING_WIDTH). The second is thinner and paler — the eye reads "an
 * underlined ring", not "two circles".
 */
function drawSelfRings(
  ctx: CanvasRenderingContext2D,
  c: XY,
  style: MarkerStyle,
  fl: number,
  alpha: number,
): void {
  ctx.strokeStyle = style.selfInk
  ctx.globalAlpha = alpha
  ctx.lineWidth = SELF_RING_WIDTH * style.k
  ctx.beginPath()
  ctx.arc(c.x, c.y, selfRingRadius(fl) * style.k, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 0.75 * alpha
  ctx.lineWidth = (SELF_RING_WIDTH / 2) * style.k
  ctx.beginPath()
  ctx.arc(c.x, c.y, selfRingRadius2(fl) * style.k, 0, Math.PI * 2)
  ctx.stroke()
  ctx.globalAlpha = 1
}

/** drawSelfHalo — the diffuse glow under the marker of the player of the page (radial gradient). */
function drawSelfHalo(
  ctx: CanvasRenderingContext2D,
  c: XY,
  style: MarkerStyle,
  fl: number,
  alpha: number,
): void {
  const r = (selfRingRadius2(fl) + SELF_HALO_PAD) * style.k
  const gradient = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
  gradient.addColorStop(0, style.selfInk)
  gradient.addColorStop(1, 'transparent')
  ctx.globalAlpha = SELF_HALO_ALPHA * alpha
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}

/** corePath traces the core (or its rim): circle, or diamond of same circumscribed radius. */
function corePath(ctx: CanvasRenderingContext2D, c: XY, r: number, shape: MarkerShape): void {
  ctx.beginPath()
  if (shape !== 'diamond') {
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
    return
  }
  ctx.moveTo(c.x, c.y - r)
  ctx.lineTo(c.x + r, c.y)
  ctx.lineTo(c.x, c.y + r)
  ctx.lineTo(c.x - r, c.y)
  ctx.lineTo(c.x, c.y - r)
  ctx.closePath()
}

function project(p: XY, view: CanvasView): XY {
  return projectTo(view, p)
}

/**
 * floorIndex: the floor of the pawn at the frame, by the GUARD SHARED with the objectives
 * (`floorInRange`) — a flat terrain places no ring at all (aligned 2026-09-18; before,
 * `floorOf` alone gave floor 1 to everyone on a map without amplitude).
 */
function floorIndex(track: ReplayTrackReady, style: MarkerStyle): number {
  const z = altitudeAt(track.points, style.frame)
  return z === null ? 0 : floorInRange(z, style.z)
}
