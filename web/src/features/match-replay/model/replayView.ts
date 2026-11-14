/**
 * replayView — THE FRAMING OF THE REPLAY, AND WHAT IT CAN DO.
 *
 * WHY THIS MODULE EXISTS (register 2026-09-05, K3). The framing — the bounds of the world, the
 * size of the canvas, the margin — was an object that NOTHING knew to project: its type was
 * re-declared NINE times identically in the feature, and the world → canvas passage was rewritten
 * at each site by unpacking the four fields by hand:
 *
 *     worldToCanvas(p, view.bounds, view.width, view.height, view.pad)
 *
 * Twenty-nine times, in twenty-two files. Each new writing was an occasion to get
 * the order wrong between `width` and `height` — two numbers of the same type, that the compiler cannot
 * arbitrate — and the fault would have shown not as an error, but as a stretched layer.
 *
 * THE FRAMING NOW KNOWS TO PROJECT. `projectTo(view, p)` and `scaleOf(view)` take the
 * WHOLE framing: there is no longer an order to remember, and the type is declared only here.
 *
 * ONE SINGLE FORM, AND NO PRE-BOUND PROJECTOR. The layers that project in a loop keep
 * a local shortcut (`const px = (p: XY) => projectTo(view, p)`): it is brevity at the
 * call site, not a second rule of projection — the rule, it, is written only here.
 *
 * IT CANNOT LIVE IN `replayLogic`, and it is structural: `worldToCanvas` is defined there,
 * so calling it there would make a cycle. `layerOffset` (replayLogic) is the only site that keeps
 * the long writing, for that reason and for it alone.
 */
import type { ReplayBounds } from '@/lib/api/types'

import { canvasScale, worldToCanvas, type XY } from '../../../lib/replay/replayLogic'

/**
 * THE FRAMING: which portion of the world we show, in which canvas, with what margin.
 *
 * It is the only declaration of this type in the feature — the eight local copies (of which
 * several wrote `bounds` as a literal rather than as `ReplayBounds`) import it.
 */
export interface CanvasView {
  bounds: ReplayBounds
  width: number
  height: number
  pad: number
}

/**
 * projectTo projects a WORLD position into the canvas, according to the framing.
 *
 * Y IS INVERTED (the world has +Y up, the canvas down), the fit preserves the
 * ratio and centers — all of this lives in `worldToCanvas`, which this function only feeds
 * with the whole framing.
 */
export function projectTo(view: CanvasView, p: XY): XY {
  return worldToCanvas(p, view.bounds, view.width, view.height, view.pad)
}

/**
 * scaleOf returns the METERS → PIXELS factor of the framing.
 *
 * It is what converts a magnitude of the world (an explosion radius, the mesh of a heat
 * map, the range of a sensor) into pixels of the canvas. Same reason for being as `projectTo`:
 * it took the four fields one by one, seven times.
 */
export function scaleOf(view: CanvasView): number {
  return canvasScale(view.bounds, view.width, view.height, view.pad)
}
