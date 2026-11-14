/**
 * weaponPadsLayer.ts — THE WEAPON PADS on the map: what the layer asserts, and the exact
 * place where it stops asserting.
 *
 * THE SOURCE is the document (schema 11): `weaponPads`, one pad per MEASURED SPATIAL
 * RECURRENCE — weapons of the same family that respawn within less than a meter, without any
 * life ending nearby. Each pad carries its world position, the WEAPON FAMILY (same writing
 * as a loadout, so the same key in `weaponLabels`), its spawns, its presence intervals, and
 * its CYCLE when it is established.
 *
 * THE POSITION CAN COME FROM ELSEWHERE since 2026-08-19, and that is the only thing that can:
 * when the answer carries `mapWeaponPads`, the caller has replaced the centroid of the spawns
 * by the position of the SPAWNER read in the map file (cf. `crossedWeaponPads`). This layer
 * does not know it and does not have to know it — it draws what it is given, and everything
 * else (presence, states, cycle) remains the measurement of the match.
 *
 * A VERTICAL STACK, AND THE DIAMOND IS ITS FOOT (user return of 2026-08-27: "l'icône doit être
 * au-dessus du petit losange, pas dedans" (the icon should be above the small diamond, not
 * inside it)). From bottom to top: the DIAMOND at the exact position of the pad, the VIGNETTE
 * placed above it (its bottom at the top of the diamond, increased by `PAD_GAP_PX`), the
 * COUNTER above. Three marks, one single column, one single place.
 *
 * THE A13 BORDER RING NO LONGER EXISTS, and it is the same return: this diamond rim, placed
 * around the vignette in the ink of the nature, IMPRISONED the image — the screen said "the
 * icon in the diamond" where the data says "a weapon above a place". Its function — make the
 * nature of the pad live on any background — comes back to the diamond, now ALWAYS FULL at
 * this ink: a flat fill of 6 px reads better than a rim of 1.4 px, and it circles nothing.
 *
 * THE THREE STATES ARE READ ELSEWHERE (`weaponPadTime.ts`): this file only DRAWS them, and
 * it draws them on the DIAMOND, which keeps its shape and its ink in the three cases — full
 * at 0.95 (presence proven); faint full at 0.55, circled by a dotted diamond HALO (the film
 * says nothing); very faint full at 0.35 and without vignette (absence proven).
 *
 * THE DOTTED LINE KEEPS ITS MEANING — the one that `placementShapes` gave it: "this limit is
 * not asserted". Here the limit is TEMPORAL and not spatial, but the message is the same,
 * and that is why it appears ONLY on the uncertain state: the full diamond, for its part,
 * says a presence or an absence that the measurement holds.
 *
 * WHAT THIS LAYER NEVER DRAWS:
 *  - THE PICKER. The field (`padPickups[].xuid`) is PUBLISHED since schema 30 (2026-08-31),
 *    the native event carrying it. No line here reads it: this layer draws PLACES, not
 *    players. It is a choice of layer, plus a data absence.
 *  - THE DROPPED OBJECTS. They are the weapons a player releases when dying; they are not
 *    pads and they are not published here (user decision of 18/08).
 *  - THE DIFFERENCE GROUND PAD / WALL RACK. The data carries only a position: nothing
 *    separates them, and the screen says "weapon location" rather than choosing one.
 *  - A COUNTDOWN WITHOUT SOURCE. Neither measured next spawn, nor established cycle: nothing
 *    is written — a dash would suggest that one would know (cf. `padRespawnAt`).
 *
 * No React: pure geometry + a CanvasRenderingContext2D, like the neighboring layers. The ink
 * comes from the caller, which holds it from the variables of the theme.
 */
import type { ReplayWeaponPadReady } from '../../../lib/replay/replayNormalize'
import { project, UNCERTAIN_DASH, type PlacementView } from './placementShapes'
import type { PadScale } from '../model/weaponPadFamilies'
import type { XY } from '../../../lib/replay/replayLogic'
import { padRespawnAt, padStateAt, type PadState } from '../model/weaponPadTime'

/** The framing is that of the placements: the two layers project the same scene. */
export type { PlacementView as PadView } from './placementShapes'

/**
 * Radius of the DIAMOND of the pad, in SCREEN pixels, per size (before area compensation).
 *
 * THE DIAMOND SAYS THE PLACE AND THE STATE, the vignette says what one finds there (verdict
 * of 2026-08-18, amended on 2026-08-27): the vignette is placed ABOVE, free, and no longer
 * in a ring — a content imprisoned at 8 px is not readable.
 */
const PAD_DOT_PX: Record<PadScale, number> = { power: 4.6, classic: 3.2 }

/**
 * Height of the weapon vignette, in screen pixels, per size.
 *
 * THE TWO VALUES ARE A SCREEN ARBITRATION, not a measurement: "des icônes trop petites
 * seraient inutiles mais des trop grosses risquent de polluer" (icons too small would be
 * useless but too big ones risk polluting) (balance of 18/08). The large one fits under the
 * name of a player (8.5 px) increased by its outline; the small one remains above the
 * neutral point of the unidentified objects (2.5 px of radius), which it must not imitate.
 */
const PAD_ICON_H_PX: Record<PadScale, number> = { power: 13, classic: 8 }

/** A weapon vignette is wide: beyond this ratio, the width is bounded. */
const PAD_ICON_MAX_ASPECT = 3.2

/** Gap between two levels of the stack (diamond, vignette, counter), in screen pixels. */
const PAD_GAP_PX = 2.5

/**
 * THE HALO OF UNCERTAINTY: a DOTTED diamond concentric with the pad, offset by `GAP` so that
 * one distinguishes it from the full one it circles, traced at the thinnest that still reads
 * on a printed map background. It appears ONLY on the uncertain state — that is its only
 * role.
 */
const PAD_HALO_GAP_PX = 2
const PAD_HALO_WIDTH = 1.2

/**
 * THE PAD IS A DIAMOND, PLUS A ROUND (A14, user return of 2026-08-26: "les socles d'armes et
 * de power up je veux pas de cercles, des points en losanges ce serait mieux, ça facilite la
 * lecture sinon on peut confondre avec des points de joueurs" (for the weapon and power-up
 * pads I don't want circles, diamond-shaped points would be better, it makes reading easier
 * otherwise one can confuse them with player points)).
 *
 * IT IS A SHAPE, NOT A SIZE: the diamond replaces the disk AT THE SAME PLACE, with the same
 * inks and the same states. A PLAYER marker remains a round; the vocabulary of the map
 * therefore gains a sharp distinction, readable even small and even in grayscale.
 *
 * THE AREA COMPENSATION IS NOT AN ORNAMENT. At equal half-diagonal, a diamond covers `2r²`
 * when a disk covers `πr²` — i.e. only 64%. Replacing one with the other without correcting
 * would have SLIMMED all the pads by a third, which is not what was asked. The factor is
 * `sqrt(π/2)` ≈ 1.2533, rounded: at this enlargement, the two shapes weigh the same ink
 * weight on the screen.
 */
const PAD_DIAMOND_GROWTH = 1.25

/**
 * traceDiamond places the outline of a centered diamond, of half-diagonal `half` (top
 * vertex up).
 *
 * ONE SINGLE COPY FOR THE TWO USES HERE — the mark and its halo of uncertainty. Two
 * tracings of the same shape would diverge at the first setting, and the drift would be
 * invisible: a halo slightly misaligned with its diamond remains credible.
 *
 * EXPORTED since the vehicles lot (2026-09-02): the marker "unresolved chassis family" of
 * `vehiclesLayer.ts` is the same neutral diamond that this file already traces for a pad —
 * the vocabulary of the repository for "an object of the map, not a player" (cf.
 * `replayMarkers.corePath`, third copy of the same tracing). REUSING this function rather
 * than writing a third is what CLAUDE.md #6 asks at the 3rd copy — the complete
 * centralization of the three (including `replayMarkers.ts`) remains a pre-existing debt,
 * outside the scope of this lot (cf. Découvertes).
 */
export function traceDiamond(ctx: CanvasRenderingContext2D, c: XY, half: number): void {
  ctx.beginPath()
  ctx.moveTo(c.x, c.y - half)
  ctx.lineTo(c.x + half, c.y)
  ctx.lineTo(c.x, c.y + half)
  ctx.lineTo(c.x - half, c.y)
  ctx.closePath()
}

/**
 * Thickness of the RIM of the vignette, in screen pixels, and the number of directions in
 * which one replays it to obtain it. Eight: at four, the diagonals let the background
 * through.
 */
const PAD_OUTLINE_PX = 1.2
const PAD_OUTLINE_STEPS = 8

/** Opacities of the diamond and of the vignette, per state. `empty` has no vignette. */
const PAD_ALPHA: Record<PadState, { dot: number; icon: number }> = {
  full: { dot: 0.95, icon: 0.95 },
  uncertain: { dot: 0.55, icon: 0.3 },
  empty: { dot: 0.35, icon: 0 },
}

/** Body of the countdown, in screen pixels, and its outline of legibility. */
const PAD_COUNTDOWN_FONT_PX = 8
const PAD_COUNTDOWN_STROKE_PX = 2.4

/**
 * Comfort margin around the stack, in screen pixels: one aims near, not to the pixel.
 *
 * THERE IS NO LONGER A VISIBILITY FLOOR (2026-08-27, adversarial review). The zone carried a
 * `Math.max(..., 9 px)` inherited from the time when it only covered the diamond — a diamond
 * of 3.2 px does not aim. Since it covers the stack, its first term is worth 12.25 px for
 * the SMALLEST size (4 + 5.25 + 3) and 16.5 px for the large one: the floor could never
 * prevail again. A `Math.max` of which a branch is unreachable is dead code that lies about
 * the rule, not a safety.
 */
const PAD_HOVER_MARGIN_PX = 3

/** What the layer needs to know of the current instant. */
export interface PadTime {
  frame: number
  /** REAL duration of a frame (`frameToMs(1, doc)`): the countdown beats in real time. */
  frameMs: number
  /** Pixel density: the screen thicknesses follow it (same rule as the markers). */
  k: number
}

/**
 * A weapon vignette ready to place: its BODY and its RIM, already tinted offscreen.
 *
 * TWO IMAGES AND NOT ONE, because a canvas does not know how to edge an image: the rim is
 * obtained by replaying the SAME SHAPE, tinted with the ink of the background, all around
 * the body. THE TWO are always served since 2026-08-27, including for a finished image of
 * the game: a rim only needs the SILHOUETTE, that the composition `source-in` returns from
 * any image with alpha (cf. `tintedIconCanvas`).
 */
export interface PadIcon {
  fill: CanvasImageSource
  outline: CanvasImageSource
}

/** What the layer borrows from the theme and the catalog of the document. */
export interface PadStyle {
  /** Neutral ink of the theme: a pad is an object of the field, it has no side. */
  ink: string
  /**
   * The TWO inks of the marking: what is FILLED with the ink of the text, what is CIRCLED
   * with that of the background. In dark theme that gives the "white filled, dark outline";
   * in light theme, the reverse.
   *
   * THEY ARE NO LONGER WORTH ONLY FOR THE COUNTDOWN since 2026-08-28. The VIGNETTE, for its
   * part, is circled with the ink of its NATURE (that of its diamond): on a grayscale map
   * background already edged in black, a black rim was confused with the setting and the
   * weapon became unreadable (user return). The choice is made at the cooking
   * (`useReplayWeaponPads`) — this layer receives the two images already tinted and does not
   * have to know the rule.
   */
  fill: string
  outline: string
  /** Vignette TINTED of the family, or null: the pad then keeps its only diamond. */
  iconOf: (weapon: string) => PadIcon | null
  /** The size to give to the pad, according to what it carries (cf. weaponPadFamilies). */
  scaleOf: (weapon: string) => PadScale
  /**
   * The ink of the NATURE of the pad — power-up, power weapon, rack (A13, 2026-08-26).
   * RESOLVED BY THE CALLER like all the others (color-tokens rule): this file knows no
   * token, it only employs the string it is given.
   */
  inkOf: (weapon: string) => string
  /**
   * The countdown already localized, in its COMPACT writing (that of the map).
   *
   * CALLED ON EVERY EMPTY PAD THAT HAS A SOURCE (D3, 2026-08-27): a measured next spawn, or
   * failing that an established cycle. The precondition of before — "only when a cycle is
   * established" — is precisely the defect that D3 corrects, half of the pads carrying none.
   * This label does NOT say where the number comes from: it is the tooltip that
   * distinguishes.
   */
  countdownLabel: (seconds: number) => string
}

/** padRadiusPx — the screen radius of the DIAMOND of a pad (its size follows what it
 * carries). */
export function padRadiusPx(pad: ReplayWeaponPadReady, style: PadStyle, k: number): number {
  return PAD_DOT_PX[style.scaleOf(pad.weapon)] * k
}

/** The three screen measures of the stack: the diamond, the vignette, the gap that
 * separates them. */
interface PadStackPx {
  /** Half-diagonal of the diamond, area compensation included. */
  half: number
  /** Height of the vignette placed above. */
  iconH: number
  /** Gap between two levels. */
  gap: number
}

/**
 * padStackPx — THE STACK OF A PAD in screen pixels, at the current density. ONE SINGLE
 * SOURCE FOR THE TRACING AND THE HOVER: two copies of these three lines would diverge at the
 * first setting, and the drift would be paid in tooltips that do not appear where the eye
 * aims.
 */
function padStackPx(pad: ReplayWeaponPadReady, style: PadStyle, k: number): PadStackPx {
  return {
    half: padRadiusPx(pad, style, k) * PAD_DIAMOND_GROWTH,
    iconH: PAD_ICON_H_PX[style.scaleOf(pad.weapon)] * k,
    gap: PAD_GAP_PX * k,
  }
}

/**
 * padAt — the pad under a point of the canvas, or null.
 *
 * THE ZONE IS A DISK CENTERED ON THE COLUMN OF THE STACK (2026-08-27), high enough to cover
 * from the bottom of the diamond to the top of the vignette: aiming the image and only
 * catching the diamond, ten pixels lower, would be exactly the defect that the new grammar
 * creates if one does not raise the zone with it.
 *
 * WHAT NEEDS TO BE KNOWN OF THIS DISK, because a disk is not a stack: it covers the CENTRAL
 * COLUMN over the whole height, but the EXTREME FLANKS of a very wide vignette (ratio close
 * to the bound `PAD_ICON_MAX_ASPECT`, i.e. ~3) come out of it — by a few pixels at mid-height,
 * by a dozen at the high corners. It is ACCEPTED (adversarial review of 2026-08-27): a
 * rectangle would make the arbitration between neighboring pads clearly less simple for a
 * gain that only concerns the ends of an image, where the eye does not aim.
 *
 * IT DEPENDS NEITHER ON THE STATE NOR ON THE LOADING of the vignettes: an empty pad occupies
 * the same place as a full pad, and a target that would move with the instant read would be
 * impossible to aim.
 *
 * The hover is replayed on the DATA, never on the pixels: they are the same projected
 * positions as the tracing. The closest prevails when two pads overlap — two weapons can
 * share a square meter on a small arena.
 *
 * TWO DISTANCES, AND THAT IS INTENDED: the BELONGING is judged on the stack (raised
 * center), the ARBITRATION between two reached pads is judged on the PLACE. Arbitrating on
 * the stacks would make the smallest neighbor win — its stack is lower, so its center closer
 * to the ground — even though the pointer is right on the diamond of the other. A pad is
 * its position.
 */
export function padAt(
  pads: readonly ReplayWeaponPadReady[],
  view: PlacementView,
  style: PadStyle,
  k: number,
  at: XY,
): ReplayWeaponPadReady | null {
  let best: ReplayWeaponPadReady | null = null
  let bestD2 = Infinity
  for (const pad of pads) {
    const c = project({ x: pad.x, y: pad.y }, view)
    const { half, iconH, gap } = padStackPx(pad, style, k)
    // The stack rises by `iconH + gap` above the diamond: its center therefore rises by
    // the half, and its half-height is that of the diamond increased by the same half.
    const rise = (iconH + gap) / 2
    const reach = half + rise + PAD_HOVER_MARGIN_PX * k
    const inPile = (at.x - c.x) ** 2 + (at.y - (c.y - rise)) ** 2 <= reach * reach
    const d2 = (at.x - c.x) ** 2 + (at.y - c.y) ** 2
    if (inPile && d2 < bestD2) {
      best = pad
      bestD2 = d2
    }
  }
  return best
}

/**
 * drawDot — THE DIAMOND of the pad: ALWAYS FULL in the ink of its nature, and it is the
 * OPACITY that says the state (2026-08-27).
 *
 * WHY FULL IN THE THREE CASES. It carried a fill in the full state and a simple outline in
 * the two others: a stroke of 1.2 px at 3 px of radius, that disappeared on a busy map
 * background — the place became invisible as soon as the weapon was taken, that is to say
 * at the exact moment one looks for the pad. The flat fill holds in all cases; the opacity
 * places it behind the scene without erasing it.
 *
 * THE DOTTED LINE IS NOT LOST, it is moved: the uncertain state gains a dotted diamond HALO
 * concentric, that keeps the meaning that `placementShapes` gives it everywhere else — "this
 * limit is not asserted" — without paying for it the legibility of the place.
 */
function drawDot(
  ctx: CanvasRenderingContext2D,
  c: XY,
  half: number,
  state: PadState,
  k: number,
): void {
  ctx.globalAlpha = PAD_ALPHA[state].dot
  traceDiamond(ctx, c, half)
  ctx.fill()
  if (state !== 'uncertain') return
  ctx.lineWidth = PAD_HALO_WIDTH * k
  ctx.setLineDash(UNCERTAIN_DASH.map((d) => d * k))
  traceDiamond(ctx, c, half + PAD_HALO_GAP_PX * k)
  ctx.stroke()
  ctx.setLineDash([])
}

/**
 * drawPadIcon — the vignette of the weapon, placed ABOVE the diamond, filled and circled.
 *
 * Imposed height, width deduced from the ratio of the image (bounded: a weapon vignette is
 * very wide). The rim is the same image replayed all around, in the ink of the background:
 * that is what sets it apart from a light map background as from a dark one.
 *
 * Without vignette — family off the catalog of the title, or visual absent — NOTHING takes
 * its place: never the icon of a neighboring weapon, and no more a fallback glyph (user
 * return of 2026-08-26: "j'ai l'impression qu'il y en a deux" (I have the impression there
 * are two)). The diamond already carries the place and the state; the name remains readable
 * at the hover.
 */
function drawPadIcon(
  ctx: CanvasRenderingContext2D,
  centre: XY,
  h: number,
  icon: PadIcon,
  k: number,
): void {
  const source = icon.fill
  const natW = 'width' in source && typeof source.width === 'number' ? source.width : 0
  const natH = 'height' in source && typeof source.height === 'number' ? source.height : 0
  const aspect = natW > 0 && natH > 0 ? Math.min(natW / natH, PAD_ICON_MAX_ASPECT) : 1
  const w = h * aspect
  const x = centre.x - w / 2
  const y = centre.y - h / 2
  const d = PAD_OUTLINE_PX * k
  for (let i = 0; i < PAD_OUTLINE_STEPS; i++) {
    const a = (i / PAD_OUTLINE_STEPS) * Math.PI * 2
    ctx.drawImage(icon.outline, x + Math.cos(a) * d, y + Math.sin(a) * d, w, h)
  }
  ctx.drawImage(source, x, y, w, h)
}

/**
 * drawCountdown — the countdown AT THE TOP OF THE STACK, filled and circled like the
 * vignette.
 *
 * ONLY THE COUNT (verdict of 2026-08-18): no median, no number of gaps, no margin — these
 * three said the CONFIDENCE in the cycle, which is a reading of analysis, not a marker of
 * map. The count, for its part, answers the only question one asks oneself looking at an
 * empty pad: in how much time.
 *
 * `topY` is the top of what is ACTUALLY drawn, and the caller has in practice only one
 * candidate to pass it: the top of the DIAMOND. A countdown is only written on an empty pad,
 * and an empty pad has no vignette — anchoring higher would make the number float above a
 * hole, detached from the pad it announces.
 *
 * EXPORTED SINCE LOT 5.8: the VEHICLE SPAWN LOCATIONS (schema 63) write the same countdown
 * above the same diamond (`vehicleCyclesLayer.ts`). A second copy of these ten lines would
 * have made the font, the gap and the thickness of the outline diverge between two marks
 * that the reader sees side by side on the same map (CLAUDE.md #6).
 */
export function drawCountdown(
  ctx: CanvasRenderingContext2D,
  c: XY,
  topY: number,
  text: string,
  style: { fill: string; outline: string; k: number },
): void {
  ctx.globalAlpha = 1
  ctx.font = `600 ${PAD_COUNTDOWN_FONT_PX * style.k}px ui-sans-serif, system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  const y = topY - PAD_GAP_PX * style.k
  if (style.outline) {
    ctx.lineJoin = 'round'
    ctx.lineWidth = PAD_COUNTDOWN_STROKE_PX * style.k
    ctx.strokeStyle = style.outline
    ctx.strokeText(text, c.x, y)
  }
  ctx.fillStyle = style.fill
  ctx.fillText(text, c.x, y)
}

/**
 * drawOnePad — THE STACK OF A PAD, from bottom to top: the diamond at the measured place,
 * the vignette above (its bottom at the top of the diamond increased by a gap, never on it),
 * the counter at the top. The vertical order IS the rule of the return of 2026-08-27.
 */
function drawOnePad(
  ctx: CanvasRenderingContext2D,
  pad: ReplayWeaponPadReady,
  c: XY,
  time: PadTime,
  style: PadStyle,
): void {
  const { half, iconH, gap } = padStackPx(pad, style, time.k)
  const state = padStateAt(pad, time.frame)
  // THE DIAMOND, IN THE INK OF ITS NATURE (A13, 2026-08-26: "bordure et couleur plus vive,
  // une couleur pour chaque type" (border and brighter color, one color for each type)). It
  // carried the neutral ink of the field, the same for the three: an overshield pad was not
  // distinguished from a rack but by its size. `style.ink` remains served and remains the
  // NEUTRAL — it no longer tints the mark, and the ordinary rack falls back on an ink of its
  // own by its own family.
  const encre = style.inkOf(pad.weapon)
  ctx.strokeStyle = encre
  ctx.fillStyle = encre
  drawDot(ctx, c, half, state, time.k)
  const iconAlpha = PAD_ALPHA[state].icon
  const icon = iconAlpha > 0 ? style.iconOf(pad.weapon) : null
  const iconBottom = c.y - half - gap
  if (icon) {
    ctx.globalAlpha = iconAlpha
    drawPadIcon(ctx, { x: c.x, y: iconBottom - iconH / 2 }, iconH, icon, time.k)
  }
  // THE COUNTER DOES NOT SAY ITS SOURCE ON THE MAP, and that is intended: at 8 px, a number
  // suffices. The distinction measured / expected is read at the hover, in the tooltip
  // (D3, 2026-08-27).
  //
  // IT ANCHORS ON THE DIAMOND, AND THAT IS A CONSEQUENCE, NOT A CHOICE (adversarial review
  // of 2026-08-27): a countdown only exists on an EMPTY pad (`padRespawnAt`), and an empty
  // pad does NOT have a vignette (`PAD_ALPHA.empty.icon` is worth 0). The top of the stack
  // IS therefore always that of the diamond here. The code carried an `icon ? … : …` of
  // which the first branch was unreachable — it described a stack that this case never
  // produces.
  const respawn = padRespawnAt(pad, time.frame, time.frameMs)
  if (respawn === null) return
  drawCountdown(ctx, c, c.y - half, style.countdownLabel(respawn.seconds), {
    fill: style.fill,
    outline: style.outline,
    k: time.k,
  })
}

/**
 * drawWeaponPadsLayer traces ALL the pads of the match at the current frame.
 *
 * They all draw, whatever their state: an empty pad remains a place of the field, and
 * erasing it would deprive the reader of the most useful information — "the power weapon is
 * no longer there". It is also what gives its anchoring to the countdown.
 */
export function drawWeaponPadsLayer(
  ctx: CanvasRenderingContext2D,
  pads: readonly ReplayWeaponPadReady[],
  view: PlacementView,
  time: PadTime,
  style: PadStyle,
): void {
  if (pads.length === 0 || view.width === 0) return
  ctx.save()
  for (const pad of pads) {
    drawOnePad(ctx, pad, project({ x: pad.x, y: pad.y }, view), time, style)
  }
  ctx.globalAlpha = 1
  ctx.restore()
}
