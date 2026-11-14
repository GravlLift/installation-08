/**
 * zoneStatesLayer.ts — THE LIVING STATE OF THE ZONES (schemas 16-18): who holds what at the
 * current frame, and the CAPTURE GAUGE that fills under your eyes.
 *
 * WHY IT LIVES BESIDE THE STATIC LAYER, AND NOT INSIDE IT. `objectivesLayer.ts` carries the
 * GEOMETRY of the objectives of the mode: it depends on neither the frame nor the reading, is
 * cooked once off-screen and re-copied. This one carries the STATE, which changes every frame —
 * the same sharing as the weapon pads, and the only way to keep both files under the line
 * threshold of the repository. Both trace the SAME shape: the outline comes from
 * `traceZonePath`, never from a second copy of the geometry.
 *
 * AND THE PAINTING LIVES IN A THIRD FILE since 2026-08-25 (`zoneStatesPaint.ts`). Here is
 * decided WHAT NEEDS to be painted — which interval covers the frame, which value the gauge
 * carries, which letter belongs to the zone; there it is HOW — the opacities, their
 * hierarchy, the order of the passes and the slicing of the progression. The cut was made when
 * the move from the outer arc to the fill of the shape pushed this file from 417 to 568 lines,
 * over the threshold of the repository: extract, never exempt. It follows a real seam, not a
 * line count — an ink setting changes without re-opening the state reading, and vice versa.
 *
 * WHAT THE LAYER SHOWS: the zone TINTED with the ink of the side that holds it, the NOT HELD
 * zone in a RECURRED GRAY outline, the ACTIVE hill in highlight, and THE CAPTURE IN PROGRESS
 * FILLING THE SHAPE (schema 18): the VALUE of the gauge at the frame, read in the `gauge`
 * series of the zone as a staircase — the last known value, held until the next point (one
 * second after the last of the series). A zone without state at this frame is NOT repainted:
 * it keeps the faint stroke of the static layer, and appears faded under the ones that are
 * held.
 *
 * THE PROGRESSION READS ON THE SHAPE, NOT AROUND IT (2026-08-25). Until now the gauge was an
 * ARC drawn OUTSIDE the zone, at a radius derived from its largest semi-dimension. Two
 * defects, and the second is the real one: the arc spoke of the base without touching it, and
 * above all ITS ANGLE FRACTION IS NOT AN AREA FRACTION as soon as the shape is not a disc —
 * on an oriented box, a half-turn of arc covers a share of the base that depends on its
 * orientation, not on the capture. The fill, for its part, is a VERTICAL SWEEP bottom -> top
 * sliced by the shape itself (`ctx.clip` on `traceZonePath`): its height is exactly the
 * published fraction, on a box as on a cylinder, and it does not cover the central letter as
 * an angular sector would have.
 *
 * THE HIERARCHY OF THE INKS, AND WHAT IT SAYS. A zone in the middle of a capture shows TWO
 * sides at once: the one that still holds it, and the one that is taking it. The owner
 * FADES during the capture (`ZONE_UNDER_CAPTURE_FILL_ALPHA`) and the progression of the
 * attacker passes OPEN over it (`ZONE_CAPTURE_FILL_ALPHA`) — the inverse would leave the
 * « gained » base dominating the screen at the precise moment it is being lost. The complete
 * scale, from the weakest to the strongest: free (no fill) < held IN THE PROCESS OF BEING
 * LOST < held < ACTIVE < progression of the attacker.
 *
 * « NOT HELD » AND « UNKNOWN STATE » DO NOT CONFUSE, and that is the reason for being of the
 * two treatments above. « Not held » is a MEASUREMENT — the interval that covers the frame
 * carries the neutral value of the ownership channel (`ZoneSpan.Owner` = `null` on the Go
 * side) — and it is drawn, in recurred. « Unknown state » is an absence of interval: the
 * layer stays silent.
 *
 * WHAT THE LAYER NO LONGER SHOWS (2026-08-18, lot C-ter part 3): the `progress` top of the
 * interval. Schema 16 traced it in an arc, a value held for the whole duration of the
 * ownership — often 1.0, for minutes — and it read as « capture in progress » when it was
 * only the maximum reached. On an artifact that does not carry `gauge` (schema <= 17), there
 * is therefore NO PROGRESSION AT ALL: better nothing than a sign that lies. This decision
 * survives the shape change of 2026-08-25 — it is the SERIES that authorizes to draw, not the
 * geometry employed to do it.
 *
 * THE HILL (King of the Hill, schema 92) IS A ZONE APART, AND THE LAYER CARRIES IT ALONE.
 * Only one hill exists at a time: the one covered by an `active` interval. The static layer
 * therefore no longer draws the hills (`staticObjectivesOf`) — six gray hills superimposed
 * said the opposite of the game — and this layer paints the whole active hill: ownership,
 * floor contours (`drawZoneFloorContours`, the language of the other objectives) and the
 * CAPTURE gauge, about one second for a side alone. Its gauge also descends: when the side
 * that holds it loses it, it EMPTIES (`gaugeRamps[].draining`) with the ink of that side.
 * Outside of its intervals, a hill is not painted, gauge included.
 *
 * A SINGLE TEXT, AND IT IS THE LETTER OF THE ZONE (2026-08-24). The layer wrote nothing,
 * because the A/B/C letter of the HUD exists in no decoded data. It still does not: what the
 * artifact now publishes (`letterRank`) is a FALLBACK ORDER — the zones ranked by increasing
 * `ti=13` slot number, a measured order reproducible from one match to another on 8 maps
 * (17 films, 8/8 identical permutations). The guard of the file is amended accordingly: it
 * authorizes THE glyph of an A-C letter, and continues to forbid any OTHER text. The verdict
 * « these are well the letters of the game » belongs to the user's Theater reading.
 */
import { drawZoneFloorContours, type ObjectiveElementReady } from './objectivesLayer'
import { floorInRange } from './floorRings'
import { type XY } from '../../../lib/replay/replayLogic'
import { paintZoneState, type ZoneStateNow } from './zoneStatesPaint'

import type { ReplayGaugePoint, ReplayZoneGaugeRamp } from '@/lib/api/types'
import type { ReplayZoneStateReady } from '../../../lib/replay/replayNormalize'
import { type CanvasView, projectTo, scaleOf } from '../model/replayView'

/**
 * ZONE_GAUGE_HOLD_MS — how long the LAST point of the series stays displayed, in REAL TIME
 * (converted into frames by `useZoneStates`, once per document).
 *
 * BETWEEN TWO POINTS, THE VALUE HOLDS — whatever the gap. The gauge of the film never
 * descends step by step (measurement of lot C-ter part 3, `echelle_7344d24f.log`): it rises
 * as long as one captures, STAYS SILENT as long as the capture is frozen (contested zone:
 * 29 s at 0.92 on `7344d24f`), and returns to zero in a single emission — which the producer
 * publishes as the last point of the ramp. A silence between two points is therefore a FROZEN
 * gauge, and the staircase keeps it on screen. Only the last point of the series has nothing
 * after it to say what it becomes: it holds one second (the producer's bound between two
 * points of a ramp), then the progression fades.
 */
export const ZONE_GAUGE_HOLD_MS = 1_000

/**
 * spanStateAt returns the state carried by the interval that covers the frame (bounds
 * INCLUSIVE), or `null` when none covers it — before the first emission of the film, the
 * zone has no KNOWN state, and drawing it « neutral » would assert something the artifact
 * does not say.
 *
 * PURE FUNCTION, and the ONLY state reading of the layer: it is what rendering calls every
 * frame, for each zone (cf. drawZoneStates). It is private because nothing outside the layer
 * reads the state of a zone; a day when something will read it, it is what one will export —
 * not a second way of doing the same reading.
 */
function spanStateAt(spans: ReplayZoneStateReady['spans'], frame: number): ZoneStateNow | null {
  for (const sp of spans) {
    if (frame < sp.t0 || frame > sp.t1) continue
    return { owner: sp.owner ?? null, active: sp.active }
  }
  return null
}

/**
 * zoneGaugeAt returns the VALUE of the gauge at the requested frame, read AS A STAIRCASE in
 * the published series: the last value whose instant is <= frame, held until the next point.
 * Returns `null` BEFORE the first point, and once the LAST point of the series is older than
 * `holdFrames` (one second: the producer's bound between two points of a ramp — beyond,
 * nothing will come to say what the gauge became).
 *
 * PURE FUNCTION, WITHOUT LINEAR INTERPOLATION AND WITHOUT EXPIRATION BETWEEN TWO POINTS:
 * between two points the real gauge moved by less than 0.02, or did not move at all (frozen
 * capture) — inventing a slope would smooth what the producer quantified, erasing the arc
 * would hide a blockage the film shows. A gauge that falls back to zero says it by a point
 * (cf. ZONE_GAUGE_HOLD_MS).
 */
export function zoneGaugeAt(
  gauge: readonly ReplayGaugePoint[],
  frame: number,
  holdFrames: number,
): number | null {
  let lo = 0
  let hi = gauge.length - 1
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (gauge[mid].t <= frame) {
      idx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (idx < 0) return null
  const p = gauge[idx]
  const last = idx === gauge.length - 1
  return last && frame - p.t > holdFrames ? null : p.v
}

/**
 * zoneElementsOf returns the SURFACE elements in the served order — the one that `zoneRef`
 * indexes.
 *
 * THE ORDER IS THE CONTRACT: `normalizeMapObjectives` stacks the zones then the markers,
 * keeping the order of the server, and `zoneStates[].zoneRef` is the index in
 * `mapObjectives.zones`. Filtering on `kind` therefore restores exactly this list.
 */
export function zoneElementsOf(
  elements: readonly ObjectiveElementReady[],
): ObjectiveElementReady[] {
  return elements.filter((e) => e.kind === 'zone')
}

/**
 * zoneCatalogMatches says whether the `zoneRef` index of the artifact is JOINABLE to the
 * served list.
 *
 * WHY THIS VERIFICATION EXISTS (review R1, 2026-08-18). `zoneRef` is an INDEX in
 * `mapObjectives.zones` — frozen at the COOKING of the artifact — whereas `mapObjectives`
 * is rebuilt AT EVERY REQUEST by the service, from the shapes catalog of the map and the
 * roles table of the title. These two lists are the same only as long as neither the catalog
 * nor the table moves. The day one of them changes without the artifacts being re-cooked,
 * the tint of the side would be placed on ANOTHER zone: an invisible and perfectly credible
 * error.
 *
 * `coverage.zones.catalog` is the number of zones the artifact had in sight. It does not
 * prove that the lists coincide — two different lists can have the same length — but it
 * catches the case that really happens: a zone added or removed from the catalog. In doubt,
 * the living layer STAYS SILENT and the static layer remains alone.
 *
 * AN ABSENT CATALOG DOES NOT PASS: an artifact that publishes states without publishing its
 * coverage allows no verification, and « not verifiable » is treated as « not joinable ».
 */
export function zoneCatalogMatches(catalog: number | null | undefined, served: number): boolean {
  return catalog != null && catalog === served
}

/**
 * capturingTeamAt — THE SIDE THAT PUSHES THE GAUGE at the requested frame, or `null` when
 * nothing measures it.
 *
 * THE READING IS THAT OF THE STAIRCASE, exactly like `zoneGaugeAt`: the ramp that covers the
 * frame holds until its top, then `holdFrames` more — the same holding as the value it
 * colors. Without this tolerance, the arc would remain drawn one second longer while
 * changing color, which would read as a change of sensor.
 *
 * `null` IN THREE CASES, AND NONE IS AN ERROR: no ramp covers the frame (the gauge is at
 * rest), the ramp that covers it names no one (the film there says NEUTRAL, or the zone has
 * no elected pusher channel and the ramp aborted), or the artifact is earlier than schema
 * 64. Rendering repaints neutral in the three.
 *
 * AN ABORTED RAMP CAN NOW CARRY A SIDE, and that is the gain of lot 5.6 on the server side:
 * the side is no longer deduced from the outcome, it is READ on the pusher channel of the
 * zone. Rendering has nothing to change to display it — it already read the key.
 */
export function capturingTeamAt(
  ramps: readonly ReplayZoneGaugeRamp[],
  frame: number,
  holdFrames: number,
): number | null {
  return gaugeRampAt(ramps, frame, holdFrames)?.capturingTeam ?? null
}

/**
 * gaugeRampAt — THE RAMP (or hill segment) that covers the frame, read as a staircase like
 * `capturingTeamAt`: until its last frame, then `holdFrames` more. `null` when none covers
 * it.
 */
export function gaugeRampAt(
  ramps: readonly ReplayZoneGaugeRamp[],
  frame: number,
  holdFrames: number,
): ReplayZoneGaugeRamp | null {
  let lo = 0
  let hi = ramps.length - 1
  let idx = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ramps[mid].t0 <= frame) {
      idx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (idx < 0) return null
  const r = ramps[idx]
  return frame > r.t1 + holdFrames ? null : r
}

/** Style of the LIVING layer: the inks are RESOLVED by the caller (color-tokens rule). */
export interface ZoneStateStyle {
  /** Ink of a side; `null` = unknown side (the film does not locate the looked-at player) — the rim stays neutral. */
  colorOfOwner: (team: number) => string | null
  /**
   * Ink of the side THAT PUSHES THE GAUGE, by its team identifier. `null` = unknown side
   * (the film does not locate the looked-at player) — the arc stays neutral.
   *
   * IT IS NO LONGER A DEDUCTION SINCE SCHEMA 64 (2026-09-20), AND THAT IS THE WHOLE CHANGE.
   * Rendering deduced the sensor from the current owner — « the side opposite » —, which
   * only holds for two sides AND only on a HELD zone: on a NEUTRAL base the deduction does
   * not exist, and the fill was painted neutral there while a team was pushing. The document
   * now publishes the side (`zoneStates[].gaugeRamps[].capturingTeam`), and this ink is
   * nothing but the translation of a team identifier into color — the same as
   * `colorOfOwner`. Since lot 5.6, this side is READ in the film (the pusher channel of the
   * zone) and no longer deduced from the outcome: the ABORTED ramps carry one too.
   *
   * ABSENT KEY = NEUTRAL, without exception: the film can name the neutral (« no one is
   * pushing »), a zone can have no elected pusher channel, and a schema <= 63 artifact
   * carries none. No geometric inference comes to replace it — that would be exactly the
   * invention the repository forbids elsewhere.
   */
  colorOfCapturer: (team: number) => string | null
  /** Neutral ink: zone no one holds, and gauge arc with no known side. */
  neutral: string
}

/**
 * ZoneStatesLayerInput — what the living layer receives from the caller (`useZoneStates`):
 * the zones in the served order, the join verdict, the resolved inks, the holding of the
 * gauge.
 */
export interface ZoneStatesLayerInput {
  /** The SURFACE zones in the served order: the one that `zoneStates[].zoneRef` indexes. */
  zoneElements: readonly ObjectiveElementReady[]
  /**
   * Is `zoneRef` joinable to `zoneElements` (cf. zoneCatalogMatches)? False: the layer
   * paints NOTHING — the index of the artifact is frozen at cooking, the served list is
   * rebuilt at the request, and tinting the wrong zone would be an invisible error.
   */
  joinable: boolean
  style: ZoneStateStyle
  /** ZONE_GAUGE_HOLD_MS converted into frames for this document (cf. zoneGaugeAt). */
  gaugeHoldFrames: number
  /** Vertical amplitude of the document (`doc.bounds`): the floor of a hill (`floorInRange`). */
  z: { min: number; max: number }
}

// THE LETTER OF THE ZONE. Same technique as the callout labels (`lib/replay/calloutsPaint.ts`):
// white outlined in black, deliberately OUTSIDE the theme, rounded outline so that the corners
// of the letters do not produce points. It is a STRUCTURAL ink of the layer — it says no
// business role, it carries contrast on the flat tints of the map, exactly like the HUD of
// the game —, so the same documented exception as `canvasInk.ts` applies. Bigger than the
// callouts: a base letter is a foreground landmark, not an annotation.
const ZONE_LETTER_FONT = '700 13px ui-sans-serif, system-ui, sans-serif'
const ZONE_LETTER_OUTLINE_WIDTH = 2.4
const ZONE_LETTER_FILL = 'rgba(255, 255, 255, 1)' // color-allow: 2026-09-06 (revue R1, C5) — STRUCTURAL tracing color (shadow / readability outline), not a color that says something: exception of the color-tokens doctrine, already documented above
const ZONE_LETTER_STROKE = 'rgba(0, 0, 0, 0.92)' // color-allow: 2026-09-06 (revue R1, C5) — STRUCTURAL tracing color (shadow / readability outline), not a color that says something: exception of the color-tokens doctrine, already documented above
/** The letters the HUD knows. The producer never publishes a rank beyond. */
const ZONE_LETTERS = ['A', 'B', 'C'] as const

/**
 * drawZoneStates paints, ON TOP of the static layer, what the film says about each zone at
 * the current frame: tint of the owner, highlight of the ACTIVE zone, and the FILL OF THE
 * CAPTURE IN PROGRESS when the gauge series carries a value at this frame.
 *
 * THIS LAYER IS NOT STATIC, and that is the whole point: its geometry does not move, its
 * STATE changes every frame — like the weapon pads. It is therefore painted in the loop,
 * not in a canvas cooked once.
 *
 * THE PROGRESSION DOES NOT DEPEND ON THE CURRENT INTERVAL: the gauge is a measurement of
 * the ZONE, published per frame; a ramp that precedes the first emission of the ownership
 * channel is drawn anyway — in the neutral ink, for lack of knowing who holds the zone, and
 * WITHOUT outline (no interval covers the frame, so no ownership to assert). When an
 * interval covers it and its owner is known, the progression takes the ink of the opposite
 * side: the one that captures.
 *
 * THE LETTER OF THE ZONE is placed LAST, in a second pass: a letter covered by the fill of
 * the next zone would be unreadable one time in three, at the whim of the catalog order. It
 * is the only text this layer writes (cf. the header).
 *
 * THE JOIN GUARD IS HERE, in the layer, and not only at the caller: when `zones.joinable`
 * is false, the function returns BEFORE the first stroke. It is the layer that refuses to
 * paint — a caller cannot forget it, and the test verifies it on the context.
 */
export function drawZoneStates(
  ctx: CanvasRenderingContext2D,
  zones: ZoneStatesLayerInput,
  states: readonly ReplayZoneStateReady[],
  view: CanvasView,
  frame: number,
): void {
  if (!zones.joinable || states.length === 0) return
  const px = (p: XY) => projectTo(view, p)
  const scale = scaleOf(view)
  const letters: { at: XY; text: string }[] = []
  zones.zoneElements.forEach((e, ref) => {
    const st = states.find((s) => s.zoneRef === ref)
    if (!st) return
    paintZoneAt(ctx, e, st, { zones, px, scale, frame })
    const text = zoneLetterOf(st.letterRank)
    if (text !== null) letters.push({ at: px(e), text })
  })
  ctx.globalAlpha = 1
  drawZoneLetters(ctx, letters)
}

/** What the painting of a zone reads from the current frame (5-parameter rule). */
interface ZoneFrame {
  zones: ZoneStatesLayerInput
  px: (p: XY) => XY
  scale: number
  frame: number
}

/**
 * paintZoneAt paints ONE zone at the current frame. A HILL (`isHillState`) is painted only
 * during its intervals — gauge included — and then carries its floor contours; a gauge that
 * EMPTIES (`draining`) takes the ink of the side that still holds the hill.
 */
function paintZoneAt(
  ctx: CanvasRenderingContext2D,
  e: ObjectiveElementReady,
  st: ReplayZoneStateReady,
  f: ZoneFrame,
): void {
  const { style, gaugeHoldFrames } = f.zones
  const hill = isHillState(st)
  const now = spanStateAt(st.spans, f.frame)
  if (hill && !now) return
  // A gauge at ZERO (at rest, or returned to zero) has no progression: a fill of null
  // height traces nothing, as well not to emit it.
  const value = zoneGaugeAt(st.gauge, f.frame, gaugeHoldFrames)
  const capture = value !== null && value > 0 ? value : null
  if (!now && capture === null) return
  const ownerInk = now && now.owner !== null ? style.colorOfOwner(now.owner) : null
  const ramp = gaugeRampAt(st.gaugeRamps, f.frame, gaugeHoldFrames)
  const inkTeam = ramp?.draining ? (now?.owner ?? null) : (ramp?.capturingTeam ?? null)
  const captureInk = inkTeam !== null ? style.colorOfCapturer(inkTeam) : null
  paintZoneState(ctx, e, {
    px: f.px,
    scale: f.scale,
    ink: ownerInk ?? style.neutral,
    held: ownerInk !== null,
    now,
    capture,
    captureInk: captureInk ?? style.neutral,
  })
  if (hill) {
    const fl = floorInRange(e.z, f.zones.z)
    drawZoneFloorContours(ctx, e, { px: f.px, scale: f.scale, color: ownerInk ?? style.neutral, rim: null, fl })
  }
}

/**
 * isHillState says whether the state is that of a HILL: the only zone whose intervals are
 * marked `active` (the producer only places `active` on the hill of the moment).
 */
export function isHillState(st: { spans: readonly { active: boolean }[] }): boolean {
  return st.spans.some((s) => s.active)
}

/**
 * staticObjectivesOf returns the objectives that the STATIC layer draws: all, except the
 * zones of a JOINABLE HILLS document — only one hill exists at a time, and it is this layer
 * that paints it (during its intervals). Not joinable, nothing changes: the living layer
 * stays silent, the static one remains alone.
 */
export function staticObjectivesOf(
  elements: readonly ObjectiveElementReady[],
  states: readonly { spans: readonly { active: boolean }[] }[],
  joinable: boolean,
): readonly ObjectiveElementReady[] {
  if (!joinable || !states.some(isHillState)) return elements
  return elements.filter((e) => e.kind !== 'zone')
}

/**
 * zoneLetterOf translates the published rank into a letter, or `null` when there is none.
 *
 * A RANK OUTSIDE THE ALPHABET DRAWS NOTHING. The producer never publishes beyond C (the
 * `zoneLetterRanks` rule refuses a catalog of more than three zones), but the client does
 * not assume it: future out-of-bounds data must stay silent, not display `undefined`.
 */
export function zoneLetterOf(rank: number | null | undefined): string | null {
  if (rank == null || !Number.isInteger(rank) || rank < 0 || rank >= ZONE_LETTERS.length) return null
  return ZONE_LETTERS[rank]
}

/**
 * drawZoneLetters writes the letters at the anchor of their zone, white outlined in black.
 *
 * WHAT THE FUNCTION DOES TO `textAlign` / `textBaseline`, EXACTLY (review reading,
 * 2026-08-25 — the previous version of this comment claimed to restore the found state,
 * which was false). It PLACES `center` / `middle` to center the glyph on the anchor, then
 * rewrites the DEFAULT VALUES of the canvas (`left` / `alphabetic`) on exiting. It reads
 * nothing and therefore does not restore a previous setting: if a previous layer had placed
 * something else, it would not find it back.
 *
 * WHY THAT IS CONSEQUENCE-FREE HERE, and under which condition it remains so: this layer is
 * the last to write text in the rendering loop, and the layers that write (callouts, names
 * under the markers, pads) all place their own alignment before tracing. None depends on an
 * inherited state. The day a text layer would rely on the state left by the previous one,
 * it is that hypothesis that would need to be re-opened — not this function alone.
 */
function drawZoneLetters(ctx: CanvasRenderingContext2D, letters: { at: XY; text: string }[]): void {
  if (letters.length === 0) return
  ctx.font = ZONE_LETTER_FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  // Rounded outline: without lineJoin round + low miterLimit, the corners of the letters
  // produce points where two segments of the outline meet (same setting as the callouts).
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.lineWidth = ZONE_LETTER_OUTLINE_WIDTH
  ctx.strokeStyle = ZONE_LETTER_STROKE
  ctx.fillStyle = ZONE_LETTER_FILL
  for (const l of letters) {
    ctx.strokeText(l.text, l.at.x, l.at.y)
    ctx.fillText(l.text, l.at.x, l.at.y)
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}
