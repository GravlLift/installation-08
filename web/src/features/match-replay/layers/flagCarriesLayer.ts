/**
 * flagCarriesLayer.ts — THE LIVES OF THE CTF FLAGS (schema 15), frame by frame.
 *
 * WHY IT LIVES BESIDE THE STATIC LAYER, AND NOT INSIDE IT. Same sharing as
 * `zoneStatesLayer.ts`: `objectivesLayer.ts` carries the GEOMETRY of the objectives (it never
 * changes, is cooked once offscreen and re-copied), this one carries the STATE, which changes
 * at every frame. It is also the only way to keep both files under the threshold of the
 * repository.
 *
 * THE FOUR STATES ARE THOSE OF THE ARTIFACT, never states invented here:
 *
 *  - `carried` — a DATED fact closes the carry. The flag is stuck to the marker of its carrier.
 *  - `carried_open` — NOTHING closes the carry: the interval runs to the end of the axis and
 *    that is an UPPER BOUND. Same icon, HOLLOW — the uncertainty is on screen, not in a note.
 *  - `dropped` — the flag is on the ground, at the published position: it is carried by no one
 *    but it is still in play.
 *  - `home` — it is at its base.
 *
 * WHO BLINKS, AND WHY (user return of 2026-08-27: the flag must "blink away from its pad").
 * THE TWO CARRIED states — `carried`, `carried_open` — blink; `home` is stable. The reading
 * that serves it is that of a CTF match: what counts is to spot at a glance that a flag is
 * OUT, without having to compare two positions. A blink at the pad would say the opposite —
 * that the situation is in progress — whereas a flag at home is precisely rest.
 * `prefers-reduced-motion` turns off the blink: full fixed opacity, the glyph stays
 * localizable (same rule as all the replay effects).
 *
 * `dropped` DOES NOT BLINK (user decision of 2026-10-07): a flag on the ground is placed at
 * the center of its return zone (`flagReturnZone.ts`), and it is the zone — disk, ring, gauge
 * — that says "it is out, and it is coming back". A glyph beating on a fixed circle reads as
 * a display defect, not as a signal; the ghost remains, full and stable.
 *
 * THE ATTENUATION NO LONGER CARRIES THE UNCERTAINTY, THE HOLE CARRIES IT. `carried_open`
 * blinks like the other off-base states and keeps its HOLLOW pennant: two signals for two
 * different things — the blink says "away from its base", the hole says "end not dated". A
 * low opacity on top would have confused them, and the blink would have erased it anyway.
 *
 * THE BASE CARRIES A PRESENT / ABSENT STATE, and that is the reading the plan asks for: when
 * the flag is `home`, the glyph sits FULL on its base; when it is elsewhere, the base keeps a
 * FAINT and FIXED glyph — "the flag is not here". This absence reminder DOES NOT BLINK: it is
 * a place marker, not an event; making it beat would give two competing blinks on screen for
 * one flag. Nothing more: no ring, no countdown.
 *
 * WHY THE BASE COMES FROM THE `home` SPANS AND NOT FROM `mapObjectives`. The two say the same
 * position — the server resolves the `flag_spawn` pads by `map_id` before publishing the
 * layer — but `mapObjectives` is REBUILT AT EACH REQUEST, whereas the spans travel with the
 * artifact. Joining the two would expose the lot to the offset the plan already measured
 * (three `flag_spawn` per CTF map, one of which is NEUTRAL at the center; two catalogs that
 * do not name the modules the same). The internal anchor cannot be the wrong flag.
 *
 * NO GAME THUMBNAIL, AND THAT IS A MEASUREMENT, not a surrender: the flag is NOT a `weap`
 * (phase 0, item 0.3 — the carry marker does not carry the weapon identifier suffix, 0
 * occurrence on 83), it therefore has no tag, and `weaponLabels` does not name it on ANY of
 * the three CTF witnesses. The glyph is therefore traced on the canvas — pole + pennant — in
 * the team ink resolved by the caller. No image URL is guessed.
 *
 * NO TEXT, like the two neighboring layers: what is said is said in the tooltip.
 */
import { type XY } from '../../../lib/replay/replayLogic'

import { type CanvasView, projectTo } from '../model/replayView'
import { carriedGlyphPlaceAt } from '../model/carriedGlyphPlace'
import { edgeMarkFor, OFFSCREEN_MARGIN_PX } from '../model/edgeClamp'
import type { ReplayFlagCarryReady } from '../../../lib/replay/replayNormalize'

/** The four states published by `flagCarries[].spans[].state` (schema 15). */
export type FlagState = 'carried' | 'carried_open' | 'dropped' | 'home'

/** The order in which the UI names them — and the list the text contract must cover. */
export const FLAG_STATES: readonly FlagState[] = ['carried', 'carried_open', 'dropped', 'home']

/**
 * FlagNow — what a flag shows at a given frame.
 *
 * `state` is returned as the artifact writes it — hence the type `string` and not the closed
 * union. A state UNKNOWN to the client (artifact more recent than this code) draws as a
 * PRESENT flag: full glyph at its published position, base marked absent. That is the least
 * misleading behavior — the object IS somewhere, the artifact says so — and the tooltip, for
 * its part, omits the state line rather than inventing a label.
 */
export interface FlagNow {
  /** The OWNER team of the flag (that of its base), as the artifact publishes it. */
  team: number
  state: string
  /** The carrier, only for the two carried states — `null` everywhere else. */
  xuid: string | null
  /** Published position of the span: that of the carrier at the span, of the drop, or of the
   * base. */
  x: number
  y: number
  /** First frame of the span: it is what gives the "since when" of the tooltip. */
  t0: number
  /**
   * THE RETURN GAUGE at this frame (schema 63), in [0, 1] — `null` when the artifact does
   * not publish one for this interval, or when no point yet precedes the frame.
   *
   * STAIRCASE, NOT INTERPOLATION: the film emits in steps and the value HOLDS until the next
   * point, exactly like the zone gauge. Interpolating would invent a regular filling the game
   * does not have — its rate follows a harmonic series and the gauge EMPTIES when no one is
   * left in the zone.
   */
  returnProgress: number | null
}

/**
 * flagReturnAt renders the value of the return gauge at the requested frame: the LAST point
 * whose instant does not exceed the frame. `null` before the first point, and `null` when the
 * artifact publishes none (artifact earlier than 63, or an interval the film did not cover).
 *
 * `undefined` AND an empty array return THE SAME THING, and that is intended: the contract
 * writes the key only when it carries points, so an empty array should never arrive — if it
 * arrived, it would still say nothing more.
 */
export function flagReturnAt(
  points: ReadonlyArray<{ t: number; v: number }> | undefined | null,
  frame: number,
): number | null {
  if (!points || points.length === 0) return null
  let value: number | null = null
  for (const p of points) {
    if (p.t > frame) break
    value = p.v
  }
  return value
}

/**
 * flagSpanAt returns the state of the flag at the requested frame, or `null` when no interval
 * covers it — before the first pickup, the artifact says nothing, and drawing "at the base"
 * by default would assert what it does not say.
 *
 * PURE FUNCTION, tested apart: it is what the render calls at every frame, and it is what
 * the hover calls to compose the tooltip.
 */
export function flagSpanAt(carry: ReplayFlagCarryReady, frame: number): FlagNow | null {
  for (const sp of carry.spans) {
    if (frame < sp.t0 || frame > sp.t1) continue
    return {
      team: carry.team,
      state: sp.state,
      xuid: sp.xuid ?? null,
      x: sp.x,
      y: sp.y,
      t0: sp.t0,
      returnProgress: flagReturnAt(sp.returnProgress, frame),
    }
  }
  return null
}

/**
 * homeAnchorOf returns the position of the BASE of the flag: that of its `home` intervals.
 *
 * `null` when the flag never came home in this film — the base is then not known to the
 * artifact, and no absence marker is drawn. It is missing data, not a zero.
 */
export function homeAnchorOf(carry: ReplayFlagCarryReady): XY | null {
  for (const sp of carry.spans) {
    if (sp.state === 'home') return { x: sp.x, y: sp.y }
  }
  return null
}

/** Style of the layer: the team ink is RESOLVED by the caller (color-tokens rule). */
export interface FlagCarriesStyle {
  /** Ink of the flag of this team; the caller serves the theme neutral if it does not know. */
  colorOfTeam: (team: number) => string
  /**
   * Ink of the BACKGROUND, resolved by the caller as well: that is the one of the rim placed
   * under the glyph. This file knows NO token — it does not even know which theme is active.
   */
  outline: string
  /** Reduced motion: the off-base blink becomes a constant opacity. */
  reducedMotion: boolean
}

// Layer settings. The glyph remains deliberately SMALLER than a player marker: it sits BESIDE
// the carrier, it must not replace it.
//
// WIDENED BY 20% ON 2026-08-26 (user return: "le drapeau faudrait les faire un tout petit
// peu plus gros" (the flags should be made a tiny bit bigger)), THEN BY A FURTHER 21% ON
// 2026-08-27 (same reader, same screen: "le rendre aussi plus gros" (make it bigger too) —
// 1.2 was not enough). It is still an ADJUSTMENT, not a scale change: at a 13 px pole the
// pennant was 9 x 6.5 px, and on a busy map background it blended with the neighboring
// markers. The three dimensions of the glyph rise together — widening them separately would
// deform the drawing — and the offset does NOT move: the glyph grows upward and to the right,
// so its anchoring on the point it qualifies stays the same.
//
// THE HOVER RADIUS FOLLOWS, and it must: it covers the pole and the pennant. Leaving it at 12
// would have made the part of the glyph gained by the widening unhoverable.
const FLAG_GLYPH_SCALE = 1.45
const FLAG_POLE_H = 13 * FLAG_GLYPH_SCALE
const FLAG_WING_W = 9 * FLAG_GLYPH_SCALE
const FLAG_WING_H = 6.5 * FLAG_GLYPH_SCALE
/** Offset of the glyph from the point it qualifies (above and to the right of the marker). */
const FLAG_OFFSET_X = 6
const FLAG_OFFSET_Y = 2

/**
 * glyphIsOffset — WHICH STATES OFFSET THE GLYPH FROM ITS POSITION (2026-09-08).
 *
 * `carried` ALONE, and the reason is in the name of the offset itself: it exists so as not
 * to cover the pawn of the carrier. The three other states — `carried_open` (carried but end
 * not dated), `dropped`, `home` — designate a PLACE, not a player, and a place must be said
 * at its exact position: that is where the ring of the return zone, the delivery marker and
 * the pad sit, all anchored on the raw position.
 *
 * `carried_open` takes the rule of the place and not that of the carry: its uncertainty
 * bears on the END of the carry, not on the position, and the hollow pennant already says it.
 */
// `string` and not `FlagState`, like `flagBlinkAlpha` just beside: the state published by the
// document is a free string, and an unknown state must behave as a PLACE (no offset) rather
// than fail the typing on data we do not control.
export function glyphIsOffset(state: string): boolean {
  return state === 'carried'
}
const FLAG_STROKE_WIDTH = 1.6
/**
 * RIM IN THE BACKGROUND INK — overhang on each side of the stroke, in screen pixels.
 *
 * WHY (user return of 2026-08-27: the flag wants "un contour" (an outline)). The glyph sits
 * on a photographic map background: depending on the zone, the team ink passes over light or
 * dark, and its edge dissolves. THE SAME silhouette placed underneath, thicker, in the
 * background ink, gives it a sharp edge without inventing a color for it — that is the
 * technique already used by the pad thumbnails, and the only one that works in BOTH themes.
 */
const FLAG_OUTLINE_PAD = 1.6
/** Thickness of the rim stroke: the stroke of the glyph, overhanging on both sides. */
const FLAG_OUTLINE_WIDTH = FLAG_STROKE_WIDTH + 2 * FLAG_OUTLINE_PAD
/** HOVER radius, in pixels: it covers the pole and the pennant, without overhanging the
 * neighbor. */
export const FLAG_HIT_RADIUS = 12 * FLAG_GLYPH_SCALE

/** Full opacity: the flag at its base, and the top of the blink. */
const ALPHA_SOLID = 0.95
/**
 * Faint opacity — it serves ONLY THE EMPTY BASE since 2026-08-27: it is an absence reminder,
 * it must stay in the background of the living glyph. `carried_open`, for its part, says its
 * uncertainty by its hollow pennant (cf. the header) and no longer by a low opacity.
 */
const ALPHA_FAINT = 0.38
/**
 * Bounds of the OFF-BASE BLINK. The hole never goes below `BLINK_MIN`: a glyph that dies
 * out completely would become unfindable half a second out of two, and the reader would lose
 * what the blink was meant to show.
 */
const BLINK_MIN = 0.35
const BLINK_MAX = ALPHA_SOLID
/**
 * Blink period, IN FRAMES — 10 frames ≈ 1 s at the documented 100 ms step of the replay.
 *
 * It is in frames and not milliseconds for the same reason as the old breathing: the layer
 * only receives the frame index, never the clock of the document. Accepted consequence — a
 * film at a different step would blink faster or slower; none has been measured to this day,
 * and the reading does not depend on the exact period.
 *
 * THE BEAT IS A COSINE, AND THAT IS MEASURABLE: the frames are WHOLE, and on an even period
 * a sine lands on none of its extrema (they arrive at the half-frames 2.5 and 7.5). The
 * amplitude actually displayed there lost 5% at each edge — 0.36..0.94 instead of
 * 0.35..0.95. The cosine places its two extrema on whole frames: the blink shows its full
 * travel, and the bounds above are what is seen, not an intention.
 */
const BLINK_PERIOD_FRAMES = 10

/**
 * FlagCarriesInput — what the layer receives from the caller (`useReplayFlagCarries`).
 *
 * `posOf` is THE reason for this field: a `carried` flag draws on the marker of its CARRIER
 * at the current frame, not at the frozen position of the span. The layer does not know how
 * to re-read a trajectory — the caller passes it the reading, like the objective pulses.
 */
export interface FlagCarriesInput {
  style: FlagCarriesStyle
  /** World position of a player at a frame, or `null` if they are not locatable. */
  posOf: (xuid: string, frame: number) => XY | null
}

/** Where the flag draws at this frame, and WITH WHICH DRESSING (carried / place). */
export interface FlagPlace {
  /** The WORLD point of the glyph. */
  at: XY
  /**
 * HAS THE CARRIER BEEN LOST OF SIGHT? True = the flag draws as a PLACE (no offset, no pawn
 * to avoid) because no carrier is on screen under it.
   */
  loose: boolean
}

/**
 * flagPlaceAt returns the WORLD point where the flag draws at this frame, and its dressing.
 *
 * CARRIER WITHOUT POSITION (audit of 2026-09-10, cause C9; lot 6.7 phase B2). The layer
 * fell back on `{x: now.x, y: now.y}` — the SPAN ANCHOR — while keeping the CARRIED
 * dressing. That was two errors in one: an EXPIRED position (the carrier has run since),
 * asserted with the decorations of an object held by a player who is not on screen. 533
 * frames out of 32,464 (1.64% of the CTF fleet) were in that case.
 *
 * THE RULE IS THAT OF THE THREE CARRIED GLYPHS (`carriedGlyphPlace.ts`): the LAST known
 * position of the carrier since the start of the carry, failing that the span anchor — which
 * remains a MEASURED position, the only one that survives — and in both cases the dressing of
 * a PLACE.
 */
export function flagPlaceAt(now: FlagNow, frame: number, posOf: FlagCarriesInput['posOf']): FlagPlace {
  if (now.state !== 'carried' && now.state !== 'carried_open') {
    return { at: { x: now.x, y: now.y }, loose: false }
  }
  const place = carriedGlyphPlaceAt(posOf, now, frame, { x: now.x, y: now.y })
  // `absent` is UNREACHABLE here (the fallback is always served), but the typing demands it
  // and it is not handled by a `!`: the span anchor is the answer, written once.
  if (place.state === 'absent') return { at: { x: now.x, y: now.y }, loose: true }
  return { at: place.at, loose: place.state === 'free' }
}

/**
 * flagBlinkAlpha — the opacity of the glyph at this frame: BLINKING when it is CARRIED,
 * STABLE at the base and on the ground (cf. the header: on the ground, it is the return
 * zone that carries the signal).
 *
 * PURE FUNCTION, exported: the Oddball skull layer will reuse it as is (renvoi written in
 * PLAN_OBJECTIFS_VIVANTS_2E_LECTURE.md, decision 7) — a carried object away from its pad is
 * read the same way, and two copies of this formula would beat at different rhythms.
 *
 * AN UNKNOWN STATE FOLLOWS THE "PRESENT" BEHAVIOR — full fixed opacity. That is the rule
 * already set by the header for artifacts more recent than this code: the object IS
 * somewhere, the artifact says so, and making what we cannot name blink would assert "it is
 * out".
 *
 * It replaces the old breathing of `dropped` (2026-08-27): the two would have said the same
 * thing two ways, and the user asked for only one.
 */
export function flagBlinkAlpha(state: string, frame: number, reducedMotion: boolean): number {
  if (reducedMotion) return ALPHA_SOLID
  if (state !== 'carried' && state !== 'carried_open') return ALPHA_SOLID
  const phase = (2 * Math.PI * frame) / BLINK_PERIOD_FRAMES
  return BLINK_MIN + (BLINK_MAX - BLINK_MIN) * (0.5 + 0.5 * Math.cos(phase))
}

/**
 * drawFlagCarries paints, ON TOP of the static layer, what the film says of each flag at the
 * current frame: the glyph on its carrier, on the ground, or at its base — and the FAINT base
 * when the flag is not there.
 *
 * A flag without state at this frame is NOT drawn: the artifact says nothing of it, neither
 * does the layer.
 *
 * OFF-SCREEN BOUNDING (off-screen squad plan, workstream B, decision D3, 2026-09-10): ONLY
 * the CARRIED glyph (`carried`/`carried_open`) is clamped to the margin when its carrier
 * leaves the visible framing — it is the only state that follows a PLAYER. The base and the
 * ground are places of the map, like a weapon pad: outside the scope ruled for this lot,
 * they remain projected without bounding, even off canvas.
 */
export function drawFlagCarries(
  ctx: CanvasRenderingContext2D,
  layer: FlagCarriesInput,
  carries: readonly ReplayFlagCarryReady[],
  view: CanvasView,
  frame: number,
): void {
  const px = (p: XY) => projectTo(view, p)
  for (const carry of carries) {
    const now = flagSpanAt(carry, frame)
    if (!now) continue
    const ink = layer.style.colorOfTeam(carry.team)
    const outline = layer.style.outline
    const anchor = homeAnchorOf(carry)
    // THE BASE FIRST, and only when the flag is not there: it is the ground of the reading,
    // the living glyph sits on top of it (they coincide when the state is `home`).
    if (anchor && now.state !== 'home') {
      // THE BASE IS NEVER OFFSET: it is a fixed place, no pawn holds itself there.
      drawFlagGlyph(ctx, px(anchor), { ink, outline, alpha: ALPHA_FAINT, hollow: true, offset: false })
    }
    const place = flagPlaceAt(now, frame, layer.posOf)
    const worldPoint = place.at
    // CARRIED IN THE SENSE OF THE RENDER: a carry whose carrier is not on screen is no longer
    // one — no margin bounding (there is no pawn to follow), no offset (nothing to avoid).
    const carried = !place.loose && (now.state === 'carried' || now.state === 'carried_open')
    // SCALE 1: this layer, like its two neighbors (bomb, skull), does not yet scale anything
    // to the screen (`k`) — its dimensions are fixed constants. The margin therefore follows
    // the same convention rather than invent a factor nothing else here consumes.
    const mark = carried ? edgeMarkFor(worldPoint, view, OFFSCREEN_MARGIN_PX, 1) : null
    const at = mark ? mark.at : px(worldPoint)
    drawFlagGlyph(ctx, at, {
      ink,
      outline,
      alpha: flagBlinkAlpha(now.state, frame, layer.style.reducedMotion),
      hollow: now.state === 'carried_open',
      offset: glyphIsOffset(now.state) && !place.loose,
    })
  }
  ctx.globalAlpha = 1
}

/** What the tracing of a glyph needs to know (5-parameter rule). */
export interface FlagGlyphPaint {
  ink: string
  /** Ink of the BACKGROUND: that of the rim placed under the silhouette (cf.
   * FLAG_OUTLINE_PAD). */
  outline: string
  alpha: number
  /** HOLLOW pennant (rim only): the state is uncertain, or the base is empty. */
  hollow: boolean
  /**
   * DOES THE GLYPH MOVE AWAY FROM THE POINT IT QUALIFIES? (2026-09-08)
   *
   * True for the only state `carried`, and that is exactly what `FLAG_OFFSET_X/Y` says of
   * itself: "above and to the right OF THE MARKER". The offset was designed so as not to
   * cover the pawn of the CARRIER — it only makes sense where that pawn exists.
   *
   * FALSE ELSEWHERE, AND THAT IS A CORRECTION (user return: "pourquoi le cercle n'a pas le
   * pied du drapeau comme centre ?" (why doesn't the circle have the foot of the flag as
   * its center?), then "même sur le point de livraison c'est pareil" (same on the delivery
   * point)). A flag on the ground, at its base or on its delivery point has no marker to
   * avoid: the offset there simply made the position LIE. All the objective decorations
   * placed in the same place — ring of the return zone, delivery marker, spawn marker —
   * anchor on the raw position; the glyph was the ONLY offset object of the layer.
   */
  offset: boolean
}

/** Path of the POLE — traced twice per glyph (rim then stroke), never re-copied. */
function traceFlagPole(ctx: CanvasRenderingContext2D, x: number, foot: number, top: number): void {
  ctx.beginPath()
  ctx.moveTo(x, foot)
  ctx.lineTo(x, top)
}

/**
 * Outline of the PENNANT placed on the CURRENT path, without opening it: that is the only
 * copy of this geometry in the file. It serves alone (`traceFlagWing`) and composed with the
 * footprint of the glyph (`strokeWingOutlineOutside`) — a third hand-written triangle would
 * drift from the other two.
 */
function wingSubpath(ctx: CanvasRenderingContext2D, x: number, top: number): void {
  ctx.moveTo(x, top)
  ctx.lineTo(x + FLAG_WING_W, top + FLAG_WING_H / 2)
  ctx.lineTo(x, top + FLAG_WING_H)
  ctx.closePath()
}

/** Path of the PENNANT — same reason as the pole: one geometry for the two passes. */
function traceFlagWing(ctx: CanvasRenderingContext2D, x: number, top: number): void {
  ctx.beginPath()
  wingSubpath(ctx, x, top)
}

/**
 * strokeWingOutlineOutside lays the rim of the HOLLOW pennant keeping only the OUTER HALF,
 * by clipping.
 *
 * WHY THIS DETOUR (adversarial review R1 of 2026-08-27, P1). A canvas stroke is CENTERED on
 * its path: at 4.8 px, the rim overhangs 2.4 px ON EACH SIDE, so 2.4 px toward the inside of
 * the pennant, of which the ink stroke (1.6 px, i.e. 0.8 px toward the inside) covers only a
 * third. On a pennant of inscribed radius 3.31 px, only 4.64 px² of visible hole remained
 * against 21.1 px² before the lot — the hole was filled at ~87%, and it is it, since that
 * same lot, that carries ALONE the end not dated of `carried_open` (the attenuation was
 * removed from it).
 *
 * THE `evenodd` RULE DOES THE WORK: the clipping path composes the footprint of the glyph AND
 * the pennant; a point inside the pennant is surrounded by TWO subpaths — even count, so OUT
 * OF THE REGION. The rim can then only lay outside, and the hole stays whole.
 *
 * `save`/`restore` strictly frame the clipping: a clipping region left open would crop ALL
 * the following layers, and that would not be seen here.
 */
function strokeWingOutlineOutside(
  ctx: CanvasRenderingContext2D,
  x: number,
  top: number,
  foot: number,
): void {
  ctx.save()
  ctx.beginPath()
  const m = FLAG_OUTLINE_WIDTH
  ctx.rect(x - m, top - m, FLAG_WING_W + 2 * m, foot - top + 2 * m)
  wingSubpath(ctx, x, top)
  ctx.clip('evenodd')
  traceFlagWing(ctx, x, top)
  ctx.stroke()
  ctx.restore()
}

/**
 * drawFlagGlyph traces the flag: a VERTICAL POLE and a TRIANGULAR PENNANT, placed on a RIM in
 * the background ink — the same silhouette, underneath, thicker (2026-08-27).
 *
 * THE RIM LAYS BY TWO WAYS, AND THE HOLLOW PENNANT DEMANDS THE SECOND (review R1 of
 * 2026-08-27, P1):
 *
 *  - FULL PENNANT and POLE — simple way: the rim is traced FIRST, then the fill (or, for the
 *    pole, the ink stroke) covers what overhangs toward the inside. A pole has no inside, a
 *    full pennant is repainted: nothing remains of the inner overhang.
 *  - HOLLOW PENNANT — clipped way (`strokeWingOutlineOutside`): there, NOTHING repaints the
 *    inside. The canvas stroke being CENTERED on its path, the inner half of the rim (2.4 px)
 *    laid on it and the ink stroke covered only 0.8 px of it: 4.64 px² of hole remained out
 *    of the 21.1 px² of before the lot — filled at ~87%. The `evenodd` clip removes the
 *    inside of the pennant from the drawing region, and the hole becomes whole again.
 *
 * THAT IS NOT A STYLE DETAIL: since that same lot, the hole carries ALONE the end not dated
 * of `carried_open` (the attenuation was removed from it in favor of the blink). A filled
 * hole is a state that no longer distinguishes itself from `carried`.
 *
 * IT FOLLOWS THE OPACITY OF THE GLYPH: a faint absence reminder must not be circled by a
 * sharp stroke, otherwise it is the rim one sees and the attenuation says nothing anymore.
 *
 * The point served is the foot of the pole, offset to sit beside the marker it qualifies
 * rather than on it. Traced on the canvas, without image: cf. the header of the file.
 */
export function drawFlagGlyph(
  ctx: CanvasRenderingContext2D,
  at: XY,
  paint: FlagGlyphPaint,
): void {
  const x = at.x + (paint.offset ? FLAG_OFFSET_X : 0)
  const foot = at.y - (paint.offset ? FLAG_OFFSET_Y : 0)
  const top = foot - FLAG_POLE_H
  ctx.globalAlpha = paint.alpha
  // The point of the pennant is an acute angle: in `miter` the rim would push a needle
  // several times longer than the requested overhang. `round` bounds it to the overhang.
  ctx.lineJoin = 'round'
  ctx.strokeStyle = paint.outline
  ctx.lineWidth = FLAG_OUTLINE_WIDTH
  traceFlagPole(ctx, x, foot, top)
  ctx.stroke()
  // The HOLLOW pennant clips its rim; the full one does not need it (its fill covers the
  // inner overhang), and clipping it for nothing would cost a save/clip/restore per frame and
  // per flag.
  if (paint.hollow) strokeWingOutlineOutside(ctx, x, top, foot)
  else {
    traceFlagWing(ctx, x, top)
    ctx.stroke()
  }
  ctx.strokeStyle = paint.ink
  ctx.fillStyle = paint.ink
  ctx.lineWidth = FLAG_STROKE_WIDTH
  traceFlagPole(ctx, x, foot, top)
  ctx.stroke()
  traceFlagWing(ctx, x, top)
  if (paint.hollow) ctx.stroke()
  else ctx.fill()
  // The context state does not leak to the following layers (same rule as `globalAlpha`).
  ctx.lineJoin = 'miter'
}

/** What a hover found: the flag, its state READ AT THIS INSTANT, and where to place the
 * tooltip. */
export interface FlagHit {
  now: FlagNow
  /** CANVAS point of the glyph — the tooltip sits there, not under the raw pointer. */
  at: XY
}

/**
 * flagAt returns the flag whose glyph is under the served CANVAS point, or `null`.
 *
 * THE HOVER REPLAYS EXACTLY THE SAME GEOMETRY AS THE TRACING (`flagPlaceAt`, same offset):
 * aiming a shape drawn elsewhere would touch nothing, and that kind of drift is not seen.
 * Only the LIVING glyph is hoverable — the faint base is only an absence reminder.
 */
export function flagAt(
  carries: readonly ReplayFlagCarryReady[],
  layer: FlagCarriesInput,
  view: CanvasView,
  frame: number,
  at: XY,
): FlagHit | null {
  let best: FlagHit | null = null
  let bestD = FLAG_HIT_RADIUS * FLAG_HIT_RADIUS
  for (const carry of carries) {
    const now = flagSpanAt(carry, frame)
    if (!now) continue
    const place = flagPlaceAt(now, frame, layer.posOf)
    const c = projectTo(view, place.at)
    // SAME OFFSET RULE AS THE TRACING (2026-09-08): it depends on the STATE, and since lot
    // 6.7 phase B2 also on `loose` (carrier lost of sight). Copying it without these
    // conditions would put the hover target 6 px from the glyph — and a target drift is not
    // seen, it is endured.
    const decale = glyphIsOffset(now.state) && !place.loose
    const cx = c.x + (decale ? FLAG_OFFSET_X : 0)
    const cy = c.y - (decale ? FLAG_OFFSET_Y : 0) - FLAG_POLE_H / 2
    const d = (cx - at.x) * (cx - at.x) + (cy - at.y) * (cy - at.y)
    if (d <= bestD) {
      bestD = d
      best = { now, at: { x: cx, y: cy } }
    }
  }
  return best
}
