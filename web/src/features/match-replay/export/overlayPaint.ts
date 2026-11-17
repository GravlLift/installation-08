// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * overlayPaint.ts — THE REPLAY OVERLAYS, PAINTED ONTO THE CANVAS.
 *
 * # WHY THIS MODULE EXISTS
 *
 * The match-end screen (`ReplayVictoryOverlay`) and the round-break message
 * (`ReplayRoundBreakOverlay`) are DOM laid OVER the canvas. That is the right choice for the
 * page: they get the theme, typography and accessibility for free, without a line of drawing
 * code. But a video encoder sees ONLY the canvas — it knows nothing of DOM floating above it.
 * Without this module, an export would stop on a mute field, never saying how the match ended,
 * which is exactly what the user watches last.
 *
 * # WHAT IS SHARED WITH THE DOM, AND WHAT ISN'T
 *
 * SHARED: the TRUTH. This module reads no data of its own — it receives a panel already decided
 * by the same logic modules as the React components (`victoryLogic`, `roundsLogic`,
 * `scoreBannerLogic`). It therefore cannot announce a different verdict or score than the
 * screen: it has nothing to compute them from.
 *
 * NOT SHARED: the PAINTING. The Tailwind classes of `replayOverlayStyles.ts` have no equivalent
 * in a 2D context; the measurements below transcribe them into pixels, once, with the source
 * class noted in a comment. That is the only duplication in this module, and it is deliberate:
 * fidelity is checked by eye on the export, not by the type system.
 *
 * # WHAT A CANVAS CANNOT DO, AND WHICH WE DO NOT FAKE
 *
 * `backdrop-blur-sm` has no equivalent: blurring what is ALREADY painted below would mean
 * reading back the canvas, blurring it and recomposing every frame — a per-frame cost for an
 * effect nobody notices on a panel already 70% opaque. It is deliberately absent.
 *
 * # COLORS ARRIVE ALREADY RESOLVED; THEY ARE NEVER READ HERE
 *
 * A painter that called `getComputedStyle` would read the theme thirty times per second of
 * match. The caller resolves once (`readInk`, `resolveToken` — see `useReplayInks`) and passes
 * the values in. That is also what makes this file testable without a DOM.
 */

/** The theme inks the overlays need, already resolved by the caller. */
export interface OverlayInk {
  /** `--background`: the VEIL color, applied at `VEIL_ALPHA`. */
  background: string
  /** `--foreground`: all text. Never the team color — contrast is not negotiable. */
  foreground: string
  /** `--muted-foreground`: the lone score separator dash. */
  muted: string
  /** `--border` and `--card`: the NEUTRAL block (tie, round-break message). */
  border: string
  card: string
}

/** The page's font families, read once by the caller. */
export interface OverlayFonts {
  sans: string
  mono: string
}

/** The status block's background and border: resolved team color, or theme tokens. */
export interface OverlayStatusStyle {
  background: string
  border: string
}

/** The final score, in banner order: ally on the left, enemy on the right. */
export interface OverlayScore {
  ally: number
  enemy: number
}

/** A panel to paint. Everything in it is already decided: this module computes no data. */
export interface OverlayPanel {
  /** The verdict, or "Round N over". Uppercased here (the DOM does it in CSS). */
  status: string
  statusStyle: OverlayStatusStyle
  /** The page player's team name. Absent on a tie and on the round-break message. */
  label?: string | null
  /** Absent when the mode publishes no score — a "0 - 0" would read as a real measurement. */
  score?: OverlayScore | null
  /**
   * The watermark, ALREADY TINTED by the caller (a monochrome silhouette consumed as a mask,
   * see `tintedIconCanvas`). Absent until it is loaded: the panel never needed the logo to say
   * how the match ended.
   */
  logo?: CanvasImageSource | null
  /** The full-frame VEIL: the match-end screen posts one, the round-break message does not. */
  veil: boolean
}

/** The surface to cover, in CSS pixels — the same frame `draw()` uses after its scaling. */
export interface OverlayView {
  width: number
  height: number
}

/** `bg-background/70` — the match-end screen's veil opacity. */
const VEIL_ALPHA = 0.7
/** `rounded-lg` = 0.5rem. */
const BLOCK_RADIUS = 8
/** `px-8 py-4` = 2rem / 1rem. */
const BLOCK_PAD_X = 32
const BLOCK_PAD_Y = 16
/** `border-2`. */
const BLOCK_BORDER = 2
/** `text-2xl` = 1.5rem, `font-bold` = 700. */
const STATUS_SIZE = 24
/** `tracking-wide` = 0.025em, expressed in px at the status text size. */
const STATUS_TRACKING = STATUS_SIZE * 0.025
/** `text-sm` = 0.875rem, `font-semibold` = 600 (the team name). */
const LABEL_SIZE = 14
const LABEL_TRACKING = LABEL_SIZE * 0.025
/** `text-3xl` = 1.875rem, `font-bold`, `font-mono` (the final score). */
const SCORE_SIZE = 30
/** `mt-2` = 0.5rem, between the block, the name and the score. */
const ROW_GAP = 8
/** `px-3` = 0.75rem on each side of the separator dash. */
const SCORE_SEP_PAD = 12
/** `h-[min(18rem,60vh)]`: 18rem, capped at 60% of the canvas height. */
const LOGO_MAX = 288
const LOGO_VIEW_RATIO = 0.6
/** `opacity-20`. */
const LOGO_ALPHA = 0.2
/**
 * `shadow-lg`: `0 10px 15px -3px rgb(0 0 0 / 0.1)` — transcribed as a context shadow.
 *
 * THE BLACK IS WRITTEN LITERALLY, AND THIS IS NOT A VIOLATION OF THE TOKEN RULE. A drop shadow
 * is not a theme color: it is a darkening of what sits BELOW it, identical in light and dark
 * theme — which is in fact how Tailwind itself defines it. Same status as the text outlines in
 * `lib/replay/calloutsPaint.ts` and `zoneStatesLayer.ts`, written the same way elsewhere in this
 * feature. What the token rule forbids is a color that SAYS something; a shadow says nothing.
 */
const SHADOW_BLUR = 15
const SHADOW_OFFSET_Y = 10
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.1)' // color-allow: 2026-09-06 (review R1, C5) — a STRUCTURAL trace color (shadow / readability outline), not a color that says something: a documented exception to the color-tokens doctrine, already explained above

/** The DOM's uppercase (`uppercase`) is a style decision: it is redone here. */
function upper(text: string): string {
  return text.toLocaleUpperCase()
}

/**
 * setTracking applies letter spacing where the browser supports it (`ctx.letterSpacing`,
 * Chrome 99+). Where it doesn't, the text is written without it — tighter than the DOM, but
 * never unreadable: emulating letter spacing character by character would cost one `fillText`
 * call per character per frame.
 */
function setTracking(ctx: CanvasRenderingContext2D, px: number): void {
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`
}

/** Width of a text run at a given font and letter spacing. */
function textWidth(ctx: CanvasRenderingContext2D, text: string, font: string, tracking: number): number {
  ctx.font = font
  setTracking(ctx, tracking)
  const w = ctx.measureText(text).width
  setTracking(ctx, 0)
  return w
}

/** roundedRect: `ctx.roundRect` when it exists, a plain rectangle otherwise (never nothing). */
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r)
  else ctx.rect(x, y, w, h)
}

const statusFont = (f: OverlayFonts) => `700 ${STATUS_SIZE}px ${f.sans}`
const labelFont = (f: OverlayFonts) => `600 ${LABEL_SIZE}px ${f.sans}`
const scoreFont = (f: OverlayFonts) => `700 ${SCORE_SIZE}px ${f.mono}`

/** The score text, without the dash: it is painted separately, in a different ink. */
function scoreParts(score: OverlayScore): { ally: string; enemy: string; sep: string } {
  return { ally: String(score.ally), enemy: String(score.enemy), sep: '-' }
}

/**
 * panelHeight measures the whole column, to center it VERTICALLY the way the DOM's
 * `flex items-center` does. Without this upfront measurement, the panel would paint from the
 * top and float above center as soon as it carries a score.
 */
function panelHeight(panel: OverlayPanel): number {
  let h = statusBlockHeight()
  if (panel.label) h += ROW_GAP + LABEL_SIZE
  if (panel.score) h += ROW_GAP + SCORE_SIZE
  return h
}

/** paintVeil covers the whole canvas — the backdrop the name and score are read against. */
function paintVeil(ctx: CanvasRenderingContext2D, view: OverlayView, ink: OverlayInk): void {
  ctx.save()
  ctx.globalAlpha = VEIL_ALPHA
  ctx.fillStyle = ink.background
  ctx.fillRect(0, 0, view.width, view.height)
  ctx.restore()
}

/**
 * paintLogo places the watermark, centered on the column and BELOW the text (the DOM's order,
 * where it sits absolutely positioned behind the paragraphs).
 */
function paintLogo(
  ctx: CanvasRenderingContext2D,
  view: OverlayView,
  logo: CanvasImageSource,
): void {
  const side = Math.min(LOGO_MAX, view.height * LOGO_VIEW_RATIO)
  ctx.save()
  ctx.globalAlpha = LOGO_ALPHA
  ctx.drawImage(logo, (view.width - side) / 2, (view.height - side) / 2, side, side)
  ctx.restore()
}

/**
 * The status card's height. A SINGLE definition, consumed by both the MEASUREMENT and the
 * PAINTING: the two used to diverge by `BLOCK_BORDER * 2`, which painted the panel 2 px above
 * center with a block-to-name gap 4 px too short.
 */
function statusBlockHeight(): number {
  return STATUS_SIZE + BLOCK_PAD_Y * 2 + BLOCK_BORDER * 2
}

/** paintStatusBlock paints the colored card and the verdict it carries. */
function paintStatusBlock(
  ctx: CanvasRenderingContext2D,
  view: OverlayView,
  panel: OverlayPanel,
  fonts: OverlayFonts,
  ink: OverlayInk,
  top: number,
): number {
  const text = upper(panel.status)
  const font = statusFont(fonts)
  const w = textWidth(ctx, text, font, STATUS_TRACKING) + BLOCK_PAD_X * 2
  const h = statusBlockHeight()
  const x = (view.width - w) / 2
  ctx.save()
  ctx.shadowColor = SHADOW_COLOR
  ctx.shadowBlur = SHADOW_BLUR
  ctx.shadowOffsetY = SHADOW_OFFSET_Y
  ctx.fillStyle = panel.statusStyle.background
  roundedRect(ctx, x, top, w, h, BLOCK_RADIUS)
  ctx.fill()
  // THE SHADOW MUST NOT DOUBLE UP ON THE BORDER: it belongs to the card, not to its stroke.
  ctx.shadowColor = 'transparent'
  ctx.lineWidth = BLOCK_BORDER
  ctx.strokeStyle = panel.statusStyle.border
  ctx.stroke()
  ctx.fillStyle = ink.foreground
  ctx.font = font
  setTracking(ctx, STATUS_TRACKING)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, view.width / 2, top + h / 2)
  setTracking(ctx, 0)
  ctx.restore()
  return top + h
}

/** paintLabel writes the team name, as free text over the veil (never inside the card). */
function paintLabel(
  ctx: CanvasRenderingContext2D,
  view: OverlayView,
  label: string,
  fonts: OverlayFonts,
  ink: OverlayInk,
  top: number,
): number {
  ctx.save()
  ctx.fillStyle = ink.foreground
  ctx.font = labelFont(fonts)
  setTracking(ctx, LABEL_TRACKING)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(upper(label), view.width / 2, top + ROW_GAP)
  setTracking(ctx, 0)
  ctx.restore()
  return top + ROW_GAP + LABEL_SIZE
}

/**
 * paintScore writes `ally - enemy`, the dash in the muted ink as in the DOM.
 *
 * THE ORDER IS THE BANNER'S (ally on the left) and it is not up for debate: on an export, the
 * banner isn't there to settle it, but the habit formed on the page is.
 */
function paintScore(
  ctx: CanvasRenderingContext2D,
  view: OverlayView,
  score: OverlayScore,
  fonts: OverlayFonts,
  ink: OverlayInk,
  top: number,
): void {
  const { ally, enemy, sep } = scoreParts(score)
  const font = scoreFont(fonts)
  const wAlly = textWidth(ctx, ally, font, 0)
  const wSep = textWidth(ctx, sep, font, 0)
  const wEnemy = textWidth(ctx, enemy, font, 0)
  const total = wAlly + SCORE_SEP_PAD * 2 + wSep + wEnemy
  let x = (view.width - total) / 2
  const y = top + ROW_GAP
  ctx.save()
  ctx.font = font
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = ink.foreground
  ctx.fillText(ally, x, y)
  x += wAlly + SCORE_SEP_PAD
  ctx.fillStyle = ink.muted
  ctx.fillText(sep, x, y)
  x += wSep + SCORE_SEP_PAD
  ctx.fillStyle = ink.foreground
  ctx.fillText(enemy, x, y)
  ctx.restore()
}

/**
 * paintOverlayPanel — THE ONLY ENTRY POINT. Paints the veil (if requested), the watermark, the
 * status card, the name and the score, in the DOM's order: from background to text.
 *
 * Returns nothing: the caller already knows whether there was a panel to paint (it built it).
 * A panel without a status does not get painted — an empty card in the middle of the screen
 * would be worse than no card.
 */
export function paintOverlayPanel(
  ctx: CanvasRenderingContext2D,
  view: OverlayView,
  panel: OverlayPanel,
  fonts: OverlayFonts,
  ink: OverlayInk,
): void {
  if (!panel.status.trim()) return
  if (panel.veil) paintVeil(ctx, view, ink)
  if (panel.logo) paintLogo(ctx, view, panel.logo)
  let y = (view.height - panelHeight(panel)) / 2
  y = paintStatusBlock(ctx, view, panel, fonts, ink, y)
  if (panel.label) y = paintLabel(ctx, view, panel.label, fonts, ink, y)
  if (panel.score) paintScore(ctx, view, panel.score, fonts, ink, y)
}

/**
 * neutralStatusStyle — the NEUTRAL block (`OVERLAY_STATUS_NEUTRAL`: `border-2 border-border
 * bg-card`), used by the tie and by the round-break message. Both share it in the DOM; they
 * share it here too, through this same function.
 */
export function neutralStatusStyle(ink: OverlayInk): OverlayStatusStyle {
  return { background: ink.card, border: ink.border }
}
