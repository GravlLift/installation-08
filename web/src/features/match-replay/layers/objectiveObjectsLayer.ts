// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * objectiveObjectsLayer.ts — THE PUBLISHED POSITIONS of the Oddball skull (schema 21) and its
 * tracing on the ground. This file is the GEOMETRIC FOUNDATION: the `objectiveObjectAt`
 * primitive (last point published, and ONLY inside [t0, t1]), the hover, and the tracing of a
 * free presence. The PRESENCE RULE — carried / free / absent, with the test of the next
 * event — lives in `skullPresence.ts`, which consumes this file in ONE DIRECTION (never the
 * inverse: this foundation does not import the rule).
 *
 * WHY IT LIVES BESIDE `flagCarriesLayer` AND NOT INSIDE IT. The two draw a mode object, but
 * they do not read the same thing: `flagCarries` publishes STATE INTERVALS (the carried flag
 * has no position of its own, the layer sticks it to its carrier); here we publish POSITIONS
 * ACTUALLY PUBLISHED by the object.
 *
 * THE INVARIANT, REWRITTEN AT SCHEMA 23. Before `skullCarries`, this layer stayed SILENT as
 * soon as a life ended — « extending the last position beyond t1 would leave the skull placed
 * while a player runs with it ». This justification is today INVERTED: rendering now KNOWS
 * when the skull is carried (`skullCarries`). The new invariant, carried by
 * `skullPresenceAt`: HOLD a rest that a PICKUP corroborates (the carrier arrives on the held
 * position); stay SILENT during known carries; stay ABSENT during a respawn or a fall-back
 * (the next beginning is then a LIFE, not a pickup — no ghost at the point of landing). NO
 * INTERPOLATION, ever: a held position is a position ACTUALLY published (the last rest), not
 * invented.
 *
 * THE GLYPH IS THE SHARED ONE OF THE SKULL (`skullGlyph.ts`): the SAME drawing as the carried
 * skull (`skullCarrierLayer`), so that one recognizes the same object — only its place changes
 * (on the ground / above a player). Dressed like the flag since 2026-08-28 (rim in the ink of
 * the background, enlarged size, two orbits): cf. the header of `skullGlyph.ts` for the why
 * and the limit (the game icon exists but is not cooked in the document).
 *
 * NO TEXT, like the neighboring layers: what is said is said in the tooltip.
 */
import { type XY } from '../../../lib/replay/replayLogic'
import { drawSkullGlyph } from './skullGlyph'

import { type CanvasView, projectTo } from '../model/replayView'
import type { ReplayObjectiveObjectReady } from '../../../lib/replay/replayNormalize'

/** The HOVER radius: more generous than the tracing, as for the flag. */
export const OBJECTIVE_OBJECT_HIT_RADIUS = 11

/**
 * ALPHA_AT_REST — the glyph of an IMMOTILE skull (life reduced to a point, or last point of a
 * ended life). It is in play, it does not move: full ink, without effect.
 */
const ALPHA_AT_REST = 0.95

/**
 * ALPHA_ROLLING — the glyph while the object is still MOVING (the life has a point at this
 * frame and another after). Slightly more sustained: it is the moment it counts the most.
 */
const ALPHA_ROLLING = 1

/** What the layer needs to know to draw itself (5-parameter rule). */
export interface ObjectiveObjectsInput {
  style: {
    /** The semantic ink of the object, resolved by the caller — never a hard color here. */
    ink: string
    /** The ink of the BACKGROUND: the rim of the skull, like that of the flag (`skullGlyph.ts`). */
    outline: string
  }
}

/** ObjectiveObjectNow — what an objective object shows at a given frame. */
export interface ObjectiveObjectNow {
  /** The life that carries this position. */
  life: ReplayObjectiveObjectReady
  /** The position in WORLD coordinates. */
  at: XY
  /** Does the object still move at this frame? (a point later in the same life) */
  rolling: boolean
}

/**
 * objectiveObjectAt returns the position of the object at the served frame, or `null` if it
 * does not replay.
 *
 * PURE PRIMITIVE, UNCHANGED: « THE LAST POINT PUBLISHED, AND ONLY INSIDE THE LIFE ». Outside
 * [t0, t1], it returns `null` — it knows nothing of the carry nor of the held rest. It is
 * `skullPresenceAt` (cf. `skullPresence.ts`) that composes this primitive with `skullCarries`
 * to decide whether to HOLD a last rest (a pickup corroborates it) or stay absent. Do not
 * move this decision here: this file remains the geometric foundation, the rule lives one
 * layer above.
 */
export function objectiveObjectAt(
  life: ReplayObjectiveObjectReady,
  frame: number,
): ObjectiveObjectNow | null {
  if (frame < life.t0 || frame > life.t1 || life.pts.length === 0) return null
  let idx = -1
  for (let i = 0; i < life.pts.length; i += 1) {
    if (life.pts[i].t > frame) break
    idx = i
  }
  if (idx < 0) return null
  const p = life.pts[idx]
  return { life, at: { x: p.x, y: p.y }, rolling: idx < life.pts.length - 1 }
}

/** objectiveObjectsAt returns ALL the objects that replay at this frame. */
export function objectiveObjectsAt(
  lives: readonly ReplayObjectiveObjectReady[],
  frame: number,
): ObjectiveObjectNow[] {
  const out: ObjectiveObjectNow[] = []
  for (const life of lives) {
    const now = objectiveObjectAt(life, frame)
    if (now) out.push(now)
  }
  return out
}

/**
 * drawFreeSkull traces the FREE skull at the WORLD position `at` served, with the SHARED
 * glyph (`skullGlyph.ts`) — the same as the carried skull. The caller (the hook) only
 * invokes it after having resolved a `free` presence via `skullPresenceAt`: this file knows
 * neither the carry nor the held rest, it places a glyph where it is told. `rolling` chooses
 * the alpha (moving / immotile).
 */
export function drawFreeSkull(
  ctx: CanvasRenderingContext2D,
  layer: ObjectiveObjectsInput,
  at: XY,
  view: CanvasView,
  rolling: boolean,
): void {
  const p = projectTo(view, at)
  drawSkullGlyph(ctx, p, {
    ink: layer.style.ink,
    outline: layer.style.outline,
    alpha: rolling ? ALPHA_ROLLING : ALPHA_AT_REST,
  })
  ctx.globalAlpha = 1
}

/** What a hover found: the object, its position READ AT THIS INSTANT, and where to place the tooltip. */
export interface ObjectiveObjectHit {
  now: ObjectiveObjectNow
  /** CANVAS point of the glyph — the tooltip is placed there, not under the raw pointer. */
  at: XY
}

/**
 * objectiveObjectHitAt returns the object whose glyph is under the served CANVAS point.
 *
 * THE HOVER REPLAYS EXACTLY THE GEOMETRY OF THE TRACING (same conversion, same center):
 * aiming at a shape drawn elsewhere would touch nothing, and this kind of gap is not seen at
 * the reading.
 */
export function objectiveObjectHitAt(
  lives: readonly ReplayObjectiveObjectReady[],
  view: CanvasView,
  frame: number,
  point: XY,
): ObjectiveObjectHit | null {
  for (const now of objectiveObjectsAt(lives, frame)) {
    const at = projectTo(view, now.at)
    const dx = at.x - point.x
    const dy = at.y - point.y
    if (dx * dx + dy * dy <= OBJECTIVE_OBJECT_HIT_RADIUS * OBJECTIVE_OBJECT_HIT_RADIUS) {
      return { now, at }
    }
  }
  return null
}
