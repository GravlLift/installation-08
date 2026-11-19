// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * damageArcPaint.ts — THE DRAWING OF THE HUD'S DIRECTIONAL DAMAGE INDICATOR.
 *
 * The data is `damageArcs.ts`; this is the pixels. The game draws the ring from a single bitmap
 * (`DamageArc.png`): a half ring that fades out toward its two ends, with a ramp along the arc
 * (the blue channel, 0 at the middle and growing toward the ends) that the game uses to reveal
 * the arc as damage accumulates. Its art and geometry are the game's own, decoded from the
 * game's UI tags; nothing here is tuned by eye. Used by BOTH the live HUD and the export.
 */
import { DAMAGE_ARC_MS, type DamageArc } from '../model/damageArcs'

/** The game's damage-arc bitmap, served by the app (game bitmap 41d89be1). */
export const DAMAGE_ARC_URL = '/static/weapons-assets/halo_infinite/hud/DamageArc.png'
/** The ring's center, in the bitmap's own pixels (INFERRED by fitting the ring; slightly below the image's bottom). */
export const DAMAGE_ARC_CENTER = { x: 360, y: 403.6 }
/** The screen height the game lays the HUD out on: the bitmap is drawn at its native size, so scale = H / 2160. */
export const DAMAGE_ARC_REFERENCE_H = 2160

/** The bitmap's own size, in pixels. */
const ARC_W = 720
const ARC_H = 390

/** The hit pulse, for the first 633 ms after the newest hit (see the file header of damageArcs). */
const PULSE_MS = 633
const PULSE_GROWTH = 0.2 // scale about the ring center, 1 to 1.2, linear over PULSE_MS
const PULSE_FADE_MS = 300 // opacity 0.5 to 0, linear, over the first 300 ms
const PULSE_ALPHA = 0.5 // the pulse's own opacity at pulseMs 0
const METER_STEPS = 32 // the reveal is quantized to steps of 1/32 and cached per step

/** The revealed-arc canvases, cached per image and per quantized meter step: a frame never rebuilds pixels it already built. */
const revealedCache = new Map<object, Map<number, HTMLCanvasElement>>()

/**
 * revealedArc: a 720x390 canvas of the image with every pixel whose ramp (B/255) is above `meter`
 * made fully transparent, and every kept pixel written as (255, 0, 0, A) — red, keeping its own
 * alpha. `meter` is quantized to steps of 1/32 and the result cached per image and step.
 */
export function revealedArc(img: HTMLImageElement | ImageBitmap, meter: number): HTMLCanvasElement {
  const step = Math.round(meter * METER_STEPS) / METER_STEPS
  let byStep = revealedCache.get(img)
  if (!byStep) {
    byStep = new Map()
    revealedCache.set(img, byStep)
  }
  let canvas = byStep.get(step)
  if (canvas) return canvas
  canvas = buildRevealed(img, step)
  byStep.set(step, canvas)
  return canvas
}

function buildRevealed(img: HTMLImageElement | ImageBitmap, meter: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = ARC_W
  canvas.height = ARC_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.drawImage(img, 0, 0, ARC_W, ARC_H)
  const data = ctx.getImageData(0, 0, ARC_W, ARC_H)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) continue // nothing drawn here
    if (px[i + 2] / 255 > meter) px[i + 3] = 0 // beyond the reveal: fully transparent
    else { px[i] = 255; px[i + 1] = 0; px[i + 2] = 0 } // red, keeping the pixel's own alpha
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

/**
 * paintDamageArcs: the live and exported ring. For each arc, the revealed canvas is drawn with
 * the image's ring center on the screen center, rotated to the arc's bearing, scaled to the
 * screen (scale = H / 2160) and faded by the arc's age; a second additive copy carries the hit
 * pulse for the first 633 ms. Nothing when the image is not loaded.
 */
export function paintDamageArcs(
  ctx: CanvasRenderingContext2D,
  arcs: readonly DamageArc[],
  center: { x: number; y: number },
  screenH: number,
  img: HTMLImageElement | ImageBitmap | null | undefined,
): void {
  if (!img) return
  const scale = screenH / DAMAGE_ARC_REFERENCE_H
  const cx = DAMAGE_ARC_CENTER.x * scale
  const cy = DAMAGE_ARC_CENTER.y * scale
  for (const arc of arcs) {
    const opacity = 1 - arc.ageMs / DAMAGE_ARC_MS
    if (!(opacity > 0)) continue
    const revealed = revealedArc(img, arc.meter)
    ctx.save()
    ctx.translate(center.x, center.y)
    ctx.rotate((arc.bearingDeg * Math.PI) / 180)
    ctx.globalAlpha = opacity
    ctx.drawImage(revealed, -cx, -cy, ARC_W * scale, ARC_H * scale)
    if (arc.pulseMs < PULSE_MS) {
      const pulseOpacity = PULSE_ALPHA * Math.max(0, 1 - arc.pulseMs / PULSE_FADE_MS)
      if (pulseOpacity > 0) {
        const pulseScale = 1 + PULSE_GROWTH * (arc.pulseMs / PULSE_MS)
        ctx.globalCompositeOperation = 'lighter'
        ctx.globalAlpha = opacity * pulseOpacity
        ctx.drawImage(revealed, -cx * pulseScale, -cy * pulseScale, ARC_W * scale * pulseScale, ARC_H * scale * pulseScale)
      }
    }
    ctx.restore()
  }
}
