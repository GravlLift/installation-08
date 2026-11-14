/**
 * meleeStar.ts — the STAR of the FATAL MELEE STRIKE.
 *
 * WHERE IT COMES FROM. "Since the sound is short and discreet, could we show a special
 * visual effect?" (report of 2026-08-18, D3). Lot R2-V had proposed a CROSS burst; the
 * verdict of the afternoon of 08/18 settles it: "a STAR, cartoon shape, not a cross".
 *
 * WHY A STAR READS, AND WHY A CROSS DOES NOT. The map already carries two crosses — the end
 * of life marker and the axes of the death effects — and a third would have added a meaning
 * to a sign that already has two. The star, for its part, exists nowhere else on this canvas:
 * the death stroke is an axis, the explosion a disk, the muzzle flash a flame, the Dynamo
 * net a web of arcs. It is the SHAPE that says "close combat", not the color.
 *
 * WHAT IT DOES NOT ASSERT: no direction. It is symmetric, and that is intended — the film
 * dates no melee impact, and the killer/victim pair of a close combat almost always falls
 * under the 1.5 px threshold that makes an axis unreliable (cf. drawKillFxLayer). It is
 * therefore placed at the PLACE OF DEATH, never between two points.
 *
 * No React, no token: the color arrives resolved from the caller (that of the killer, like
 * every death effect).
 */

/** Duration of the star, in ms — the one proposed on the board (R2-3) and validated. */
export const MELEE_STAR_MS = 400

/** Number of BRANCHES. Eight: four would have made a cross again, sixteen a bristly disk. */
const STAR_BRANCHES = 8

/** Radii of the vertices, in screen pixels: the long spike and the hollow between two spikes. */
const STAR_OUTER_PX = 13
const STAR_INNER_PX = 5

/** The white-hot core at the center, in screen pixels. */
const STAR_CORE_PX = 2.6

/** Thickness of the spike outline. */
const STAR_LINE_PX = 1.6

/**
 * meleeStarProgress — the progress of the star in [0, 1], or null when it is over.
 *
 * `reduced` freezes the star at its full brilliance (0.45) for its whole duration: under
 * "reduced motion" it does not burst, it is there and then it is no longer there.
 */
export function meleeStarProgress(ageMs: number, reduced: boolean): number | null {
  if (ageMs < 0 || ageMs > MELEE_STAR_MS) return null
  return reduced ? 0.45 : ageMs / MELEE_STAR_MS
}

/**
 * drawMeleeStar — the star at the point of the death.
 *
 * TWO CLOCKS, like the other effects of the canvas: it BURSTS (the first third opens it to
 * its full size) then FADES (the two remaining third makes it pale). A star that would appear
 * at its final size would not read as a blow dealt.
 */
export function drawMeleeStar(
  ctx: CanvasRenderingContext2D,
  at: { x: number; y: number },
  progress: number,
  k: number,
  color: string,
): void {
  const ouverture = Math.min(1, progress / 0.33)
  const extinction = progress < 0.33 ? 1 : Math.max(0, (1 - progress) / 0.67)
  const outer = STAR_OUTER_PX * k * ouverture
  const inner = STAR_INNER_PX * k * ouverture
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineJoin = 'round'
  ctx.lineWidth = STAR_LINE_PX * k
  ctx.beginPath()
  for (let i = 0; i < STAR_BRANCHES * 2; i++) {
    const a = (i / (STAR_BRANCHES * 2)) * Math.PI * 2 - Math.PI / 2
    const r = i % 2 === 0 ? outer : inner
    const px = at.x + Math.cos(a) * r
    const py = at.y + Math.sin(a) * r
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  // The body of the star is SOLID but discreet, its outline sharp: it is the outline that
  // carries the shape on a map background, the fill that gives it its mass.
  ctx.globalAlpha = 0.35 * extinction
  ctx.fill()
  ctx.globalAlpha = 0.95 * extinction
  ctx.stroke()
  ctx.globalAlpha = Math.min(1, 1.1 * extinction * extinction)
  ctx.beginPath()
  ctx.arc(at.x, at.y, STAR_CORE_PX * k, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}
