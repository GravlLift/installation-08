// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * zoneStatesPaint.ts — HOW a living zone is painted: the ownership, the capture progress,
 * and the scale of opacities that hierarchizes them.
 *
 * WHY THIS FILE EXISTS (2026-08-25, item D-R). `zoneStatesLayer.ts` decides WHAT MUST BE
 * PAINTED — it reads the interval that covers the frame, the value of the gauge, the letter
 * of the zone. This file decides HOW: which opacities, in which order, with which breakdown.
 * The boundary is not cosmetic: the layer grew from 417 to 568 lines in going from the outer
 * arc to the fill of the shape, that is, above the repository threshold, and the rule is to
 * EXTRACT rather than to exempt. The breakdown follows the natural seam — reading of state
 * on one side, primitives of rendering on the other — and not an arbitrary split to hold a
 * line count.
 *
 * THE GEOMETRY IS NOT HERE, AND MUST NEVER ENTER. Every shape comes from `traceZonePath`
 * (`objectivesLayer.ts`), and the screen footprint from `zoneCornersWorld` /
 * `zoneCanvasRadius`, the two helpers that same file exports for that. A second formula of
 * shape would diverge at the first fix, and the gap would be invisible because plausible.
 *
 * THE INKS ARRIVE RESOLVED (color-tokens rule): this file chooses none, it only chooses
 * OPACITIES and thicknesses. No color value is written there.
 */
import {
  traceZonePath,
  zoneCanvasRadius,
  zoneCornersWorld,
  type ObjectiveElementReady,
} from './objectivesLayer'
import type { XY } from '../../../lib/replay/replayLogic'

/**
 * ZoneStateNow — what a zone shows at a given frame.
 *
 * `owner` is `null` when NO ONE holds it: it is a measurement (the neutral value of the
 * ownership channel), not an absence of data — hence the field, rather than an omitted
 * state. The apex `progress` of the interval no longer figures there: the rendering no
 * longer reads it.
 *
 * IT LIVES HERE, AND NOT IN THE LAYER, so that the dependency stays ONE WAY: the layer
 * imports the paint, never the reverse. The type that the two share therefore belongs to the
 * imported file.
 */
export interface ZoneStateNow {
  owner: number | null
  active: boolean
}

// Settings of the living layer. Sharper than the static layer (which stays underneath): it
// is the contrast between the two that makes the flip read, and the zones without current
// state keep their weak stroke — they appear dimmed without having to be repainted.
//
// THE TWO OWNERSHIP FILLS WERE STRENGTHENED on 2026-08-25 (item D-R, user return "la teinte
// est trop discrète" (the tint is too discreet)): held 0.22 -> 0.30, active 0.30 -> 0.42.
// The gap BETWEEN THE TWO widens at the same time as they rise — otherwise strengthening
// the held zone would have erased what distinguishes the active hill, which is the most
// useful landmark of the map. The full scale and its invariant are tested
// (`ZONE_ALPHA_ORDER`).
const ZONE_HELD_FILL_ALPHA = 0.3
const ZONE_HELD_STROKE_ALPHA = 0.95
const ZONE_HELD_STROKE_WIDTH = 2.5
const ZONE_ACTIVE_FILL_ALPHA = 0.42
const ZONE_ACTIVE_STROKE_WIDTH = 3.5
/**
 * ZONE NOT TAKEN: THE GRAYED OUTLINE (user request of 2026-08-25, "bases non prises :
 * contour grisé" (bases not taken: grayed outline)).
 *
 * THE INK WAS ALREADY THE RIGHT ONE — the neutral of the theme — but the STROKE was that of
 * a held zone: same opacity (0.95), same thickness (2.5). A base that no one holds therefore
 * asserted itself as strongly as a won base, and distinguished itself only by its tint and
 * the absence of fill. It is now IN RETREAT: thinner, more transparent. "No one" is a weak
 * state, it is drawn weak.
 *
 * THE THRESHOLD IS `owner === null`, NOT `held` — and the nuance is one of meaning. `held`
 * is false in TWO cases: no one holds the zone (a MEASUREMENT of the film), or someone holds
 * it but the page cannot locate their side (the film does not locate the player being
 * watched). The second is not a free zone: graying it would tell the reader it is to be
 * taken while it is held. It therefore keeps the full stroke, in the neutral ink.
 */
const ZONE_FREE_STROKE_ALPHA = 0.5
const ZONE_FREE_STROKE_WIDTH = 1.6

/**
 * CAPTURE IN PROGRESS: the progress of the attacker, and the erasure of the owner.
 *
 * `ZONE_CAPTURE_FILL_ALPHA` is the strongest fill of the layer, and that is intended: during
 * a capture, what matters on screen is WHAT IS CHANGING, not what is acquired.
 * `ZONE_UNDER_CAPTURE_FILL_ALPHA` is the weakest, under that of an ordinary held zone: the
 * owner retreats while their base is being taken. The two are read together — the part
 * still theirs, the part already taken —, what an outer arc could not say.
 *
 * A FREE ZONE IN CAPTURE HAS NO OWNERSHIP TINT TO WEAKEN: the progress there is the ONLY
 * fill, and its ink stays NEUTRAL (the film does not say who is pushing the gauge, cf.
 * `ZoneStateStyle.colorOfCapturer`).
 */
const ZONE_CAPTURE_FILL_ALPHA = 0.55
const ZONE_UNDER_CAPTURE_FILL_ALPHA = 0.16

/**
 * ZONE_ALPHA_ORDER — THE SCALE OF OWNERSHIP, from the weakest to the strongest, EXPORTED TO
 * BE TESTED.
 *
 * WHY THIS CONSTANT EXISTS. These five opacities are only worth one compared to the other:
 * it is their ORDER that carries the reading (free < in loss < held < active < progress),
 * not their absolute values, and the visual gate of the user can move all of them. A
 * setting raised alone would break the reading without breaking any test that targets a
 * value — hence an invariant of ORDER rather than five numeric expectations.
 *
 * The FREE zone enters it at zero: it has no fill at all, and that is the bottom of the
 * scale.
 */
export const ZONE_ALPHA_ORDER = [
  0,
  ZONE_UNDER_CAPTURE_FILL_ALPHA,
  ZONE_HELD_FILL_ALPHA,
  ZONE_ACTIVE_FILL_ALPHA,
  ZONE_CAPTURE_FILL_ALPHA,
] as const

/** What the tracing of a living zone needs to know (5-parameter rule). */
export interface ZonePaint {
  px: (p: XY) => XY
  scale: number
  ink: string
  /**
   * `false` = no side TO TINT: OUTLINE ONLY, no ownership fill. Two distinct situations
   * produce it — no one holds the zone, or their side is not locatable (the film does not
   * locate the player being watched) — and only the FIRST one grays the outline (cf.
   * ZONE_FREE_STROKE_*, which is decided on `now.owner`, not on this flag).
   */
  held: boolean
  /**
   * The state of the zone at this frame, or `null` when NO interval covers it. The second
   * case only comes carried by a `capture`: a gauge ramp that precedes the first emission of
   * the ownership channel. Nothing is painted there but the progress — no tint nor outline,
   * lacking ownership to assert.
   */
  now: ZoneStateNow | null
  /** The value of the gauge at the frame, in ]0, 1], or `null`: no capture in progress. */
  capture: number | null
  /** The ink of the progress: the facing side, or the neutral (cf. `colorOfCapturer`). */
  captureInk: string
}

/**
 * Held zone: fill + outline in the ink of the side. Active zone: both, strengthened.
 * NOT TAKEN zone: GRAYED outline, in retreat, without fill (cf. ZONE_FREE_STROKE_*).
 * ZONE IN CAPTURE: the tint of the owner fades and the progress of the attacker fills the
 * shape from the bottom (cf. `paintCaptureFill`).
 *
 * THE ORDER OF PAINTING IS THE READING, and it is not interchangeable: ownership, then
 * progress, then outline. The progress passes OVER the tint because it is the new
 * information; the outline passes LAST because a rim half covered by a fill clipped to the
 * same shape would read as a thinner stroke — that is, as a free zone, exactly the
 * misunderstanding that lot A had just corrected.
 */
export function paintZoneState(
  ctx: CanvasRenderingContext2D,
  e: ObjectiveElementReady,
  p: ZonePaint,
): void {
  if (p.capture !== null) paintCaptureFill(ctx, e, p)
  else paintOwnerFill(ctx, e, p, false)
  if (p.now === null) return
  // "FREE" IS A MEASUREMENT, not an absence: `owner === null` is the neutral value of the
  // ownership channel (cf. ZoneSpan.Owner on the Go side). A zone of which NO interval
  // covers the frame only shows its progress (above): "we do not know" must not be read
  // "no one holds it".
  const free = p.now.owner === null && !p.now.active
  ctx.globalAlpha = free ? ZONE_FREE_STROKE_ALPHA : ZONE_HELD_STROKE_ALPHA
  ctx.strokeStyle = p.ink
  ctx.lineWidth = p.now.active
    ? ZONE_ACTIVE_STROKE_WIDTH
    : free
      ? ZONE_FREE_STROKE_WIDTH
      : ZONE_HELD_STROKE_WIDTH
  traceZonePath(ctx, e, p.px, p.scale)
  ctx.stroke()
}

/**
 * paintCaptureFill paints a zone IN CAPTURE: the tint of the owner WEAKENED first, the
 * progress of the attacker CLEAR on top.
 *
 * THE TWO ARE HERE BECAUSE THEY ARE TUNED AGAINST EACH OTHER: the erasure of the owner only
 * makes sense accompanied by what replaces it. The case without capture, for its part, only
 * places the full tint — `paintOwnerFill` alone.
 */
function paintCaptureFill(
  ctx: CanvasRenderingContext2D,
  e: ObjectiveElementReady,
  p: ZonePaint,
): void {
  paintOwnerFill(ctx, e, p, true)
  const box = zoneCanvasBox(e, p.px, p.scale)
  const h = (box.bottom - box.top) * Math.min(Math.max(p.capture ?? 0, 0), 1)
  if (h <= 0) return
  // THE CUT BY THE SHAPE ITSELF: a rectangle in SCREEN space, clipped by the outline of the
  // zone. That is what makes the fill agnostic of the family — an oriented box and a
  // cylinder pass through the same `traceZonePath`, without a single special case here.
  ctx.save()
  traceZonePath(ctx, e, p.px, p.scale)
  ctx.clip()
  ctx.globalAlpha = ZONE_CAPTURE_FILL_ALPHA
  ctx.fillStyle = p.captureInk
  ctx.fillRect(box.left, box.bottom - h, box.right - box.left, h)
  ctx.restore()
}

/**
 * paintOwnerFill places the ownership tint — WEAKENED when a capture is in progress. No
 * tint on a free zone nor on a non-locatable side: `held` says it.
 */
function paintOwnerFill(
  ctx: CanvasRenderingContext2D,
  e: ObjectiveElementReady,
  p: ZonePaint,
  underCapture: boolean,
): void {
  if (p.now === null || !(p.held || p.now.active)) return
  traceZonePath(ctx, e, p.px, p.scale)
  ctx.globalAlpha = underCapture
    ? ZONE_UNDER_CAPTURE_FILL_ALPHA
    : p.now.active
      ? ZONE_ACTIVE_FILL_ALPHA
      : ZONE_HELD_FILL_ALPHA
  ctx.fillStyle = p.ink
  ctx.fill()
}

/** The SCREEN footprint of a zone: what the capture fill sweeps from bottom to top. */
interface ZoneCanvasBox {
  left: number
  right: number
  top: number
  bottom: number
}

/**
 * zoneCanvasBox returns the screen footprint of a zone, from THE SAME geometry as the
 * tracing — `zoneCornersWorld` for a box, `zoneCanvasRadius` for a cylinder, both exported
 * by `objectivesLayer` exactly for that. No formula of shape is copied here.
 */
function zoneCanvasBox(
  e: ObjectiveElementReady,
  px: (p: XY) => XY,
  scale: number,
): ZoneCanvasBox {
  if (e.family === 'cylinder') {
    const c = px(e)
    const r = zoneCanvasRadius(e, scale)
    return { left: c.x - r, right: c.x + r, top: c.y - r, bottom: c.y + r }
  }
  const pts = zoneCornersWorld(e).map(px)
  const xs = pts.map((q) => q.x)
  const ys = pts.map((q) => q.y)
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  }
}
