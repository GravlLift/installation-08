// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldAlert.ts — the red empty-shield alert and the health strip around the shield bar, read
 * from the game's shield screen (`cusc 9299c419`, gitignored dump; summary in
 * `data/probe/uidump/out/shield-screen-summary.md`) and the three bitmaps the HUD build writes
 * (`ShieldGlow.png`, `ShieldBurst.png`, `HealthBar.png`, see `internal/weaponicons/hud.go`).
 *
 * CONFIRMED from the dump:
 * - The glow: a container 2048x290 holding two 1080x256 quads of the glow bitmap, the second
 *   mirrored (scale_x -1), at opacity 2, under a full-screen container tinted ARGB
 *   (1, 1, 0.224, 0.224). It is shown (container opacity 1) while the expression "a <= 0 && !b"
 *   holds, and hidden at once otherwise.
 * - The frame flash: in that same state a meter quad over the bar (`688a5df0`, bitmap 6a4c867b)
 *   loops its opacity 0 -> 1 at 333 ms -> 0 at 666 ms.
 * - The break burst: when "a <= 0 && b == 0" fires, a quad of the burst bitmap (flipped in y)
 *   animates over 766 ms: scale_x 1 -> 9, scale_y 1 -> 5, margin_top 0 -> 555, opacity 1 held to
 *   433 ms, then 0 at 766 ms. It sits in the same red-tinted container, top-center.
 * - The health strip: a container (margin_top 94) of three 800-wide quads of the health bitmap
 *   (track, chase, fill), tinted by the named color `hud_wires`, brought to opacity 1 over 333 ms
 *   when the shield is not full (state `health_low`).
 *
 * INFERRED (stated here, not in the data):
 * - "a" is the shield and "b" the overshield or recharge: the glow is our `broken` state (empty,
 *   not recharging), and the burst starts when `broken` begins.
 * - Where the glow sits: its bottom edge 28 game units below the bar's center. The layout puts
 *   the glow container's bottom at 48 and the bar's center near 20 (if the bar's unset vertical
 *   alignment centers it), and the owner's two reference frames agree within a few units.
 * - The glow is drawn fully lit. The game also loops the glow quads' meter value 0 -> 1 -> 0 every
 *   666 ms, but what that meter does to this bitmap is not settled, and both reference frames show
 *   the glow fully lit.
 * - The frame flash's bitmap (6a4c867b) streams its pixels from another file and is not built:
 *   the flash is drawn with the bar's own outline (the quad's alpha) in the glow's red.
 * - The burst is drawn additively (its bitmap is gray on opaque black), its scale about its own
 *   center, its keyframes linear; its top starts at the container's top, 20 units above the bar's
 *   center (the same layout as the glow).
 * - The health strip's color: the named color is not decoded, so it is MEASURED on the owner's two
 *   reference frames (the strip reads rgb(240, 173, 66) in both). It drains from both ends toward
 *   the center (both frames show it centered under the bar), and sits 78% of the way down the bar.
 */

/** The game's glow, burst and health bitmaps, served by the app (the HUD folder). */
export const SHIELD_GLOW_URL = '/static/weapons-assets/halo_infinite/hud/ShieldGlow.png'
export const SHIELD_BURST_URL = '/static/weapons-assets/halo_infinite/hud/ShieldBurst.png'
export const HEALTH_BAR_URL = '/static/weapons-assets/halo_infinite/hud/HealthBar.png'

/** The red of the alert's container tint, ARGB (1, 1, 0.224, 0.224). */
export const SHIELD_ALERT_RGB: readonly [number, number, number] = [255, 57, 57]
/** The glow quads' opacity (2: the bitmap's alpha doubled, clamped). */
export const SHIELD_GLOW_GAIN = 2

/** One glow quad's size in game units (the bar is 940 wide in the same units). */
export const SHIELD_GLOW_W = 1080
export const SHIELD_GLOW_H = 256
/**
 * How far each glow half is pushed past the bar's center (then clipped at it), in game units: two
 * of the bitmap's 512 columns. Its last two columns are block-compression artifacts (measured:
 * column 510 brighter, 511 dimmer than their neighbors), and mirroring would double them into a
 * line down the middle. A drawing fix, not game data.
 */
export const SHIELD_GLOW_SEAM_TRIM = 2 * 1080 / 512
/** The glow's bottom edge below the bar's center, in game units (inferred, see the header). */
export const SHIELD_GLOW_BOTTOM_BELOW_CENTER = 28

/** The frame flash's loop: opacity 0 -> 1 at half -> 0. */
export const SHIELD_FLASH_LOOP_MS = 666

/** The burst's bitmap size and its animation (keyframes of the dump). */
export const SHIELD_BURST_W = 512
export const SHIELD_BURST_H = 256
export const SHIELD_BURST_MS = 766
const BURST_HOLD_MS = 433
const BURST_SCALE_X: readonly [number, number] = [1, 9]
const BURST_SCALE_Y: readonly [number, number] = [1, 5]
const BURST_DROP = 555
/** The burst container's top above the bar's center, in game units (inferred, see the header). */
export const SHIELD_BURST_TOP_ABOVE_CENTER = 20

/** The health strip: drawn 800 game units wide (the 606-wide bitmap stretched), its color measured. */
export const HEALTH_BAR_W = 800
export const HEALTH_BAR_RGB: readonly [number, number, number] = [240, 173, 66]
/** The health bitmap's native size; the strip is drawn keeping its aspect. */
export const HEALTH_BITMAP_W = 606
export const HEALTH_BITMAP_H = 64
/** Where the strip's middle row sits, as a share of the bar's height from its top (measured). */
export const HEALTH_BAR_CENTER_SHARE = 0.78

/** shieldGlowShown: whether the empty-shield glow and frame flash are on. */
export function shieldGlowShown(state: string): boolean {
  return state === 'broken'
}

/** shieldFrameFlash (0..1): the frame flash's opacity `ageMs` into the empty state (a 666 ms triangle loop). */
export function shieldFrameFlash(ageMs: number): number {
  const phase = (Math.max(0, ageMs) % SHIELD_FLASH_LOOP_MS) / SHIELD_FLASH_LOOP_MS
  return phase < 0.5 ? phase * 2 : 2 - phase * 2
}

/** One frame of the break burst: its scale, how far it has dropped (game units), and its opacity. */
export interface ShieldBurstFrame {
  scaleX: number
  scaleY: number
  drop: number
  opacity: number
}

/** shieldBurstAt: the burst `ageMs` after the shield broke, or null outside its 766 ms. */
export function shieldBurstAt(ageMs: number): ShieldBurstFrame | null {
  if (ageMs < 0 || ageMs >= SHIELD_BURST_MS) return null
  const p = ageMs / SHIELD_BURST_MS
  const lerp = ([a, b]: readonly [number, number]) => a + (b - a) * p
  const opacity = ageMs <= BURST_HOLD_MS ? 1 : 1 - (ageMs - BURST_HOLD_MS) / (SHIELD_BURST_MS - BURST_HOLD_MS)
  return { scaleX: lerp(BURST_SCALE_X), scaleY: lerp(BURST_SCALE_Y), drop: BURST_DROP * p, opacity }
}

/**
 * The burst's box in the bar's units (x, y of its top-left, w, h), for a bar centered at
 * (`cx`, `cy`): the bitmap scaled about its own center, starting with its top 20 units above the
 * bar's center and dropping.
 */
export function shieldBurstBox(frame: ShieldBurstFrame, cx: number, cy: number): { x: number; y: number; w: number; h: number } {
  const w = SHIELD_BURST_W * frame.scaleX
  const h = SHIELD_BURST_H * frame.scaleY
  const centerY = cy - SHIELD_BURST_TOP_ABOVE_CENTER + SHIELD_BURST_H / 2 + frame.drop
  return { x: cx - w / 2, y: centerY - h / 2, w, h }
}

/** healthStripShown: the strip is up while the shield is not full and the film records health. */
export function healthStripShown(state: string, health: number | null): health is number {
  return health != null && state !== 'full'
}

/** The health strip's box in the bar's units for a bar `barH` tall centered at x `cx`. */
export function healthStripBox(cx: number, barH: number): { x: number; y: number; w: number; h: number } {
  const h = HEALTH_BAR_W * HEALTH_BITMAP_H / HEALTH_BITMAP_W
  return { x: cx - HEALTH_BAR_W / 2, y: barH * HEALTH_BAR_CENTER_SHARE - h / 2, w: HEALTH_BAR_W, h }
}

/** healthStripHalf: the lit half-width of the strip (game units) at a health fraction, draining toward the center. */
export function healthStripHalf(health: number): number {
  return (HEALTH_BAR_W / 2) * Math.max(0, Math.min(1, health))
}
