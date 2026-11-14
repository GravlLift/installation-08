/**
 * replayLabels.ts — THE NAME UNDER THE POINT.
 *
 * USER REQUEST OF 2026-08-16, word for word: "ajouter le pseudo en dessous des points (avec
 * une bordure sur les lettres pour faciliter la lecture sur les fonds clairs et foncés)" (add
 * the gamertag under the points (with a border on the letters to make reading easier on light
 * and dark backgrounds)). The border is not an ornament: the baked map background runs from
 * very light gray (playable area) to near black (rim), and a single-color name disappears on
 * one side or the other. It is the POC technique — `strokeText` then `fillText`, round join
 * so that the letter junctions do not make points.
 *
 * THE OUTLINE IS DARK IN BOTH THEMES (`--replay-label-stroke`, cf. globals.css): it frames
 * letters that themselves carry the TEAM color of the player. A light outline in the light
 * theme would make the name unreadable on the playable area, which is exactly light.
 *
 * WHY A SEPARATE FILE: `replayMarkers.ts` was brushing against the repository size threshold,
 * and the label is a distinct concern from the marker (typography versus geometry).
 */
import type { XY } from '../../../lib/replay/replayLogic'

/** Font body, in SCREEN pixels (like everything addressed to the eye here). */
const LABEL_FONT_PX = 8.5
/** Weight: semi-bold — an 8.5 px name in normal weight dissolves under its outline. */
const LABEL_WEIGHT = 600
/** Thickness of the readability outline, in screen pixels. */
const LABEL_STROKE_PX = 2.6
/** Gap between the outer edge of the marker and the top of the text. */
const LABEL_GAP_PX = 2.5

/**
 * What the label borrows from the style of the layer. Structural by design: `MarkerStyle`
 * satisfies it without this file having to import the marker (the reverse would be a cycle).
 */
export interface LabelStyle {
  /** Canvas density. */
  k: number
  /** Ink of the letter outline. Empty = the theme does not carry the variable: no outline. */
  labelStroke: string
}

/**
 * drawNameLabel writes `name` centered under the marker.
 *
 * `markerEdge` is the distance from the center to the OUTER edge of EVERYTHING the marker
 * draws — its rim, its floor ring (placed at a fixed radius, wider than the disk) or its
 * identity ring, the largest of the three — in screen pixels: it belongs to the geometry of
 * the marker, which computes it and passes it. The text aligns by its TOP (`textBaseline
 * top`), so it hangs under that edge, never rises onto the point.
 */
export function drawNameLabel(
  ctx: CanvasRenderingContext2D,
  c: XY,
  name: string,
  style: LabelStyle,
  color: string,
  markerEdge: number,
): void {
  const k = style.k
  ctx.font = `${LABEL_WEIGHT} ${LABEL_FONT_PX * k}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  const y = c.y + markerEdge + LABEL_GAP_PX * k
  ctx.globalAlpha = 1
  if (style.labelStroke) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = LABEL_STROKE_PX * k
    ctx.strokeStyle = style.labelStroke
    ctx.strokeText(name, c.x, y)
  }
  ctx.fillStyle = color
  ctx.fillText(name, c.x, y)
}
