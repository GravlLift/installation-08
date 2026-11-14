/**
 * skullGlyph.ts — the GLYPH OF THE SKULL of Oddball, traced ONE single time for its TWO
 * layers.
 *
 * WHY CENTRALIZED (2026-08-28). The skull was drawn in TWO copies — a bare disk copied in
 * `objectiveObjectsLayer` (the FREE skull, on the ground) and in `skullCarrierLayer` (the
 * skull ON ITS CARRIER). The doctrine "the SAME disk, so that one recognizes the same
 * object" only held through vigilance; a single function makes it true by construction, and
 * that is what is needed for the two skulls to change their dressing TOGETHER.
 *
 * ITS DRESSING IS THAT OF THE FLAG (user return of 2026-08-28: "prendre son icône et le
 * mettre comme on a mis le drapeau — taille et contour" (take its icon and place it the way
 * the flag was placed — size and outline)). The flag is NOT a game thumbnail (cf.
 * `flagCarriesLayer`, header): it is a canvas glyph placed on a RIM in the ink of the
 * BACKGROUND, which gives it a sharp edge on a photographic map background, in both themes.
 * The skull borrows this rim, at the SAME size (`FLAG_OUTLINE_PAD`), and grows to weigh as
 * much as the wing of the flag — the disk at r=5 was getting lost on a busy background.
 *
 * THE SHAPE STAYS A BALL, distinct from the flag's pole + pennant: two mode objects of the
 * same glyph would be indistinguishable on a map where both appear, and the replay is also
 * read in grayscale in print. It carries TWO ORBITS carved in the ink of the background so
 * as to read "skull" and not "dot" — the minimum that evokes the Oddball thumbnail without
 * demanding a fine drawing unreadable at this size.
 *
 * NO GAME ICON HERE, AND THAT IS A SCOPE LIMIT, NOT A GRAPHIC CHOICE. The skull does have an
 * extracted thumbnail (`jeu/contour-25.png`, `nom_jeu: skull`, tag weap `0017592c`), but its
 * URL is NOT baked into the replay document — unlike the weapon thumbnails
 * (`weaponLabels[id].img`) — and the client never GUESSES an atlas index (the
 * `killfeed-NN` trap, documented at the sound guardrail: an index that moves from one season
 * breaks the join IN SILENCE). Wiring it properly requires a Go lot that publishes the URL
 * in the document; until then, this canvas glyph holds the role, exactly as for the flag.
 */
import type { XY } from '../../../lib/replay/replayLogic'

/**
 * SKULL_GLYPH_RADIUS — radius of the disk (the skull), in canvas pixels.
 *
 * ENLARGED on 2026-08-28 (r=5 → r=7) to weigh as much as the flag (wing ~9.4 px wide):
 * a bare disk of radius 5 was blending into the neighboring marks on a busy map background.
 * STILL SMALLER THAN THE MARKER OF A PLAYER — the skull is an object, not an actor.
 */
export const SKULL_GLYPH_RADIUS = 7

/** Overhang of the rim beyond the disk, in pixels — SAME SIZE as the flag (`FLAG_OUTLINE_PAD`). */
const SKULL_LISERE_PAD = 1.6
/**
 * Width of the rim stroke. The canvas stroke is CENTERED on its path: its inner half
 * (`SKULL_LISERE_PAD` toward the center) is covered by the fill of the disk, only the
 * outer overhang remains — a sharp edge, the technique of the pedestal thumbnails and of
 * the flag.
 */
const SKULL_LISERE_WIDTH = 2 * SKULL_LISERE_PAD

/** An orbit: its radius and its offset from the center. Two points that make it read "skull". */
const SKULL_EYE_RADIUS = 1.4
const SKULL_EYE_DX = 2.7
const SKULL_EYE_DY = 0.6

/** What the tracing of a skull needs to know (5-parameter rule). */
export interface SkullGlyphPaint {
  /** Ink of the disk: the neutral of the theme, resolved by the caller (never a hard-coded color). */
  ink: string
  /**
   * Ink of the BACKGROUND: the rim placed UNDER the disk, AND the orbits carved in it — that
   * is the one of the flag (`markInk.outline` = `--background`), not a layout edge.
   */
  outline: string
  alpha: number
}

/**
 * drawSkullGlyph places the skull at `center`: a rim in the ink of the background, a disk in
 * the neutral ink on top, two orbits carved in the ink of the background.
 *
 * THE POINT SERVED IS THE CENTER, never an offset point: it is the caller that applies their
 * own offset — the free skull is placed on its published position, the carried skull ABOVE
 * the marker of its carrier. The glyph, for its part, is the same.
 */
export function drawSkullGlyph(ctx: CanvasRenderingContext2D, center: XY, paint: SkullGlyphPaint): void {
  ctx.globalAlpha = paint.alpha
  // THE RIM FIRST, in the ink of the background: the fill then covers its inner half, only
  // the overhang remains — the sharp edge the flag gained on 2026-08-27.
  ctx.beginPath()
  ctx.arc(center.x, center.y, SKULL_GLYPH_RADIUS, 0, Math.PI * 2)
  ctx.lineWidth = SKULL_LISERE_WIDTH
  ctx.strokeStyle = paint.outline
  ctx.stroke()
  // THE DISK, in the neutral ink: it hides the inner half of the rim.
  ctx.beginPath()
  ctx.arc(center.x, center.y, SKULL_GLYPH_RADIUS, 0, Math.PI * 2)
  ctx.fillStyle = paint.ink
  ctx.fill()
  // THE TWO ORBITS, carved in the ink of the background: that is what makes it read "skull"
  // and not "dot". In the ink of the background, they contrast with the neutral of the disk
  // in both themes, like the rim.
  ctx.fillStyle = paint.outline
  ctx.beginPath()
  ctx.arc(center.x - SKULL_EYE_DX, center.y - SKULL_EYE_DY, SKULL_EYE_RADIUS, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(center.x + SKULL_EYE_DX, center.y - SKULL_EYE_DY, SKULL_EYE_RADIUS, 0, Math.PI * 2)
  ctx.fill()
}
