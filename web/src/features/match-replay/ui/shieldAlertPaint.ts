// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldAlertPaint.ts — the canvas side of the empty-shield alert and the health strip
 * (`model/shieldAlert`), for the video export: the same pieces `ShieldBar3d` draws in SVG, in the
 * bar's game units scaled by `u` pixels per unit from the bar's top-left (`ox`, `oy`).
 */
import {
  HEALTH_BAR_RGB, healthStripBox, healthStripHalf, healthStripShown, SHIELD_ALERT_RGB, SHIELD_GLOW_BOTTOM_BELOW_CENTER,
  SHIELD_GLOW_GAIN, SHIELD_GLOW_H, SHIELD_GLOW_SEAM_TRIM, SHIELD_GLOW_W, shieldBurstAt, shieldBurstBox, shieldGlowShown,
} from '../model/shieldAlert'

type Rgb = readonly [number, number, number]

/**
 * recolor: a canvas of `img` at its own size where every pixel is `rgb` at its alpha times `gain`
 * (`solid`), or `rgb` at an alpha of its gray level (`luma`: a gray-on-black bitmap meant to be
 * added, whose black stays transparent). Where a canvas cannot be read (a headless test) it
 * returns `img` itself.
 */
export function recolor(img: CanvasImageSource & { width: number; height: number }, rgb: Rgb, mode: 'solid' | 'luma', gain = 1): CanvasImageSource {
  try {
    const c = document.createElement('canvas')
    c.width = img.width; c.height = img.height
    const cx = c.getContext('2d')
    if (!cx || !c.width || !c.height) return img
    cx.drawImage(img, 0, 0)
    const data = cx.getImageData(0, 0, c.width, c.height)
    const px = data.data
    for (let i = 0; i < px.length; i += 4) {
      const a = mode === 'solid' ? Math.min(255, px[i + 3] * gain) : px[i]
      px[i] = rgb[0]; px[i + 1] = rgb[1]; px[i + 2] = rgb[2]; px[i + 3] = a
    }
    cx.putImageData(data, 0, 0)
    return c
  } catch {
    return img
  }
}

/** The alert's bitmaps, already recolored (`alertArtOf`); a missing one is not drawn. */
export interface ShieldAlertArt {
  glow?: CanvasImageSource
  burst?: CanvasImageSource
  health?: CanvasImageSource
}

/** alertArtOf: recolor the loaded glow, burst and health bitmaps once for painting. */
export function alertArtOf(glow?: HTMLImageElement, burst?: HTMLImageElement, health?: HTMLImageElement): ShieldAlertArt {
  return {
    glow: glow ? recolor(glow, SHIELD_ALERT_RGB, 'solid', SHIELD_GLOW_GAIN) : undefined,
    burst: burst ? recolor(burst, SHIELD_ALERT_RGB, 'luma') : undefined,
    health: health ? recolor(health, HEALTH_BAR_RGB, 'solid') : undefined,
  }
}

/** The bar's frame, in game units, and where it is on the canvas. */
export interface AlertPlacement {
  ox: number
  oy: number
  /** Pixels per game unit. */
  u: number
  /** The bar's center x and height in game units. */
  cx: number
  barH: number
}

/** paintShieldGlow: the empty-shield glow, drawn before (under) the bar. */
export function paintShieldGlow(ctx: CanvasRenderingContext2D, art: ShieldAlertArt, at: AlertPlacement, state: string): void {
  if (!art.glow || !shieldGlowShown(state)) return
  const { ox, oy, u, cx, barH } = at
  const y = oy + (barH / 2 + SHIELD_GLOW_BOTTOM_BELOW_CENTER - SHIELD_GLOW_H) * u
  const w = SHIELD_GLOW_W * u, h = SHIELD_GLOW_H * u
  const center = ox + cx * u
  // Each half pushed past the center and clipped at it (see SHIELD_GLOW_SEAM_TRIM).
  const trim = SHIELD_GLOW_SEAM_TRIM * u
  for (const side of [1, -1]) {
    ctx.save()
    ctx.translate(center, 0); ctx.scale(side, 1)
    ctx.beginPath(); ctx.rect(-w, y, w, h); ctx.clip()
    ctx.drawImage(art.glow, trim - w, y, w, h)
    ctx.restore()
  }
}

/** paintShieldOver: the health strip and the break burst, drawn after (over) the bar. */
export function paintShieldOver(ctx: CanvasRenderingContext2D, art: ShieldAlertArt, at: AlertPlacement, state: string, stateAgeMs: number, health: number | null): void {
  const { ox, oy, u, cx, barH } = at
  if (art.health && healthStripShown(state, health)) {
    const box = healthStripBox(cx, barH)
    const half = healthStripHalf(health)
    if (half > 0) {
      ctx.save()
      ctx.beginPath(); ctx.rect(ox + (cx - half) * u, oy + box.y * u, 2 * half * u, box.h * u); ctx.clip()
      ctx.drawImage(art.health, ox + box.x * u, oy + box.y * u, box.w * u, box.h * u)
      ctx.restore()
    }
  }
  const burst = art.burst && shieldGlowShown(state) ? shieldBurstAt(stateAgeMs) : null
  if (art.burst && burst) {
    const box = shieldBurstBox(burst, cx, barH / 2)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = burst.opacity
    // Flipped in y about the box's own middle.
    ctx.translate(0, oy + (box.y + box.h / 2) * u); ctx.scale(1, -1)
    ctx.drawImage(art.burst, ox + box.x * u, -box.h * u / 2, box.w * u, box.h * u)
    ctx.restore()
  }
}
