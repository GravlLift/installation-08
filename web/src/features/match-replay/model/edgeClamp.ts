// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * edgeClamp.ts — THE PURE GEOMETRY OF OFFSCREEN CLAMPING (worksite B, offscreen squad
 * plan, 2026-09-10).
 *
 * WHY. `worldToCanvas` (`lib/replay/replayLogic.ts`, exposed here via `projectTo`) is an
 * affine projection WITHOUT clamping: a point outside the framing bounds projects outside the
 * canvas, the canvas bitmap clips it, and the marker disappears without a reference. At tight zoom
 * (2x/3x), it is the position of a whole player that is lost. `edgeMarkFor` answers a single
 * question, without drawing anything: where to place a marker FLUSH TO THE MARGIN, in which direction
 * does it point toward the true position, and at what distance (in meters) is it located.
 *
 * WHY THIS MODULE LIVES HERE, AND NOT IN `lib/replay/` (deviation from the path of the plan
 * `PLAN_ESCOUADE_HORS_CADRE_2026-09-09.md`, §4 B0.1, corrected on the spot at execution). The
 * framing (`CanvasView`) and its projection (`projectTo`, `scaleOf`) no longer LIVE in
 * `lib/replay/` since batch K3 (2026-09-05): they live in `replayView.ts`, next door, and
 * it is that same header page that forbids « a second rule of projection ». No
 * file of `lib/replay/` (outside test fixtures) imports anything from the feature —
 * the reverse would break the low/high layer of the repository. This module therefore respects the same rule
 * as all the layers (`replayMarkers.ts`, `flagCarriesLayer.ts`...): it lives in the feature,
 * next to the framing it consumes, never a second declaration.
 *
 * UNITS. `c` is a WORLD point. `margeEcran` is in REFERENCE SCREEN pixels (before scaling),
 * `echelle` is the same factor as `style.k` elsewhere in the replay (density of the
 * canvas) — the FLUSH margin therefore follows the same convention as every quantity addressed to
 * the eye in this feature. The distance rendered, for its part, is in WORLD METERS: it divides
 * the pixel gap by `scaleOf(view)`, never the reverse.
 *
 * `at`/`angle` ARE IN CANVAS SPACE (post-projection): the inversion of Y (world +Y
 * up, canvas +Y down) is already done by `projectTo` — this module does not redo it, it only
 * clamps and measures what it produced.
 */
import type { XY } from '../../../lib/replay/replayLogic'
import { type CanvasView, projectTo, scaleOf } from './replayView'

/**
 * OFFSCREEN_MARGIN_PX — the CANONICAL clamping margin of worksite B, in reference screen pixels
 * (before scaling by `k`). All the layers that clamp a glyph to the
 * margin (living players, death cross, objective carriers) SHARE it — never a local copy
 * (CLAUDE.md n°6): a margin that diverges from one layer to another would make the
 * references float at different distances from the edge for the same framing.
 */
export const OFFSCREEN_MARGIN_PX = 16

/** What the clamping returns for an offscreen point: where to place it, toward which way, at what distance. */
export interface EdgeMark {
  /** CANVAS position where to place the reference, clamped to the margin on both axes. */
  at: XY
  /** CANVAS angle (radians), from `at` toward the projected real position. */
  angle: number
  /** Distance between the edge and the real position, in WORLD METERS. */
  distanceM: number
}

/**
 * edgeMarkFor projects `c` and clamps it to `margeEcran * echelle` pixels from the edge of `view`.
 *
 * Returns `null` when the projection falls ALREADY inside the bounded frame (nothing to report: the
 * normal marker suffices). A point just on the margin is considered INSIDE — the margin
 * is the last valid position, not the first one offscreen.
 */
export function edgeMarkFor(
  c: XY,
  view: CanvasView,
  margeEcran: number,
  echelle: number,
): EdgeMark | null {
  const p = projectTo(view, c)
  const marge = margeEcran * echelle
  const minX = marge
  const maxX = view.width - marge
  const minY = marge
  const maxY = view.height - marge
  const dedans = p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY
  if (dedans) return null
  const at: XY = {
    x: Math.min(Math.max(p.x, minX), maxX),
    y: Math.min(Math.max(p.y, minY), maxY),
  }
  const dx = p.x - at.x
  const dy = p.y - at.y
  const distancePx = Math.hypot(dx, dy)
  return { at, angle: Math.atan2(dy, dx), distanceM: distancePx / scaleOf(view) }
}
