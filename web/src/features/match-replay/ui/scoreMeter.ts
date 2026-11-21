// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * scoreMeter.ts — fill the score bars with the game's own meter bitmap (ScoreMeter.png).
 *
 * CONFIRMED (from the game's center scoreboard screen, cusc fb8c6614, and the decoded bitmap):
 * the HUD set carries ScoreMeter.png, served at /static/weapons-assets/halo_infinite/hud/
 * ScoreMeter.png (the same folder as ShieldQuad.png). It is 800x64, its header's size, and a
 * channel-packed MASK, not colors: A is the bar's rounded-rectangle shape (255 inside, 0 in the
 * 2-px margin, anti-aliased corners), B is a linear ramp from 0 at the left end to 255 at the
 * right (x / 800 x 255), R is 255 and G is 0. The game draws each team's fill as a two-tone meter
 * of this bitmap whose meter value is the team's score fraction: one tone is fully transparent,
 * the other is the team color, and the right team's quad has bitmap_flipx = 1 (mirrored).
 * (Before the shared bitmap decoder, the app misread the same 409600-byte payload as a 1600x256
 * BC7 image: a striped picture this file was once fitted to.)
 *
 * INFERRED (stated here, unchanged from the striped reading): the fill grows from the ramp's high
 * (RIGHT) end, which for the left bar is the screen's center (today's left bar fills from the
 * center); the right bar uses the mirrored bitmap, so it also fills from the center. A pixel is
 * filled when its ramp >= 1 - fill. The meter's own comparison direction is not decoded.
 */

/** The game's score meter bitmap, served by the app (the HUD folder, cf. `SHIELD_QUAD_URL`). */
export const SCORE_METER_URL = '/static/weapons-assets/halo_infinite/hud/ScoreMeter.png'

/** A meter mask read from the bitmap: the B (ramp) and A (shape) channels, row-major. */
export interface ScoreMeterMask {
  width: number
  height: number
  ramp: Uint8ClampedArray
  shape: Uint8ClampedArray
}

/**
 * meterPixelAlpha: one mask pixel's alpha at a fill fraction (0..1), from its ramp (B) and shape
 * (A), both 0..255. The pixel is filled when ramp / 255 >= 1 - fill (the fill grows from the
 * ramp's high end); then its alpha is the shape's, A / 255; unfilled, 0.
 */
export function meterPixelAlpha(ramp: number, shape: number, fill: number): number {
  if (fill <= 0 || ramp / 255 < 1 - fill) return 0
  return shape / 255
}

/** parseColor: a CSS color to [r, g, b] in 0..255 (a hex or rgb()/rgba() string; black if it does not parse). */
function parseColor(color: string): [number, number, number] {
  const s = color.trim()
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) {
    const x = m[1]
    return [parseInt(x[0] + x[0], 16), parseInt(x[1] + x[1], 16), parseInt(x[2] + x[2], 16)]
  }
  m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) {
    const x = m[1]
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]
  }
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s)
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])]
  return [0, 0, 0]
}

/**
 * paintScoreMeter: draw the meter's filled pixels into the box [x, y, w, h] on `ctx`. The mask
 * is sampled at nearest neighbor for each output pixel; a filled pixel is drawn in `color` at
 * the shape's alpha (else nothing), honoring `flip` (mirror in x). Built on a w x h scratch
 * canvas and drawn into `ctx`, so it composites over the track.
 */
export function paintScoreMeter(ctx: CanvasRenderingContext2D, mask: ScoreMeterMask, x: number, y: number, boxW: number, boxH: number, fill: number, color: string, flip: boolean): void {
  if (boxW <= 0 || boxH <= 0 || mask.width <= 0 || mask.height <= 0) return
  // The scratch canvas is whole pixels: a fractional box (the export's bar is size * 4.2)
  // would make every ImageData index fractional, and those writes are silently dropped.
  const w = Math.max(1, Math.round(boxW)), h = Math.max(1, Math.round(boxH))
  const [r, g, b] = parseColor(color)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const octx = canvas.getContext('2d')
  if (!octx) return
  const image = octx.createImageData(w, h)
  const data = image.data
  for (let oy = 0; oy < h; oy++) {
    const my = Math.min(mask.height - 1, Math.floor((oy / h) * mask.height))
    for (let ox = 0; ox < w; ox++) {
      const srcX = Math.min(mask.width - 1, Math.floor((ox / w) * mask.width))
      const mx = flip ? mask.width - 1 - srcX : srcX
      const i = my * mask.width + mx
      const alpha = meterPixelAlpha(mask.ramp[i], mask.shape[i], fill)
      if (alpha > 0) {
        const p = (oy * w + ox) * 4
        data[p] = r
        data[p + 1] = g
        data[p + 2] = b
        data[p + 3] = Math.round(alpha * 255)
      }
    }
  }
  octx.putImageData(image, 0, 0)
  ctx.drawImage(canvas, x, y, boxW, boxH)
}

/**
 * readScoreMeterMask: draw `img` at `width` x `height` (the bitmap's own 800x64 by default) and
 * read its B (ramp) and A (shape) channels (the canvas's premultiplied round trip only blurs B
 * on the anti-aliased corners, where A is partial). A null 2d context (no canvas, e.g. a headless
 * test) yields a zero mask.
 */
export function readScoreMeterMask(img: HTMLImageElement, width = 800, height = 64): ScoreMeterMask {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { width: 0, height: 0, ramp: new Uint8ClampedArray(0), shape: new Uint8ClampedArray(0) }
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height).data
  const ramp = new Uint8ClampedArray(width * height)
  const shape = new Uint8ClampedArray(width * height)
  for (let i = 0; i < width * height; i++) {
    ramp[i] = data[i * 4 + 2]
    shape[i] = data[i * 4 + 3]
  }
  return { width, height, ramp, shape }
}

let meterMaskPromise: Promise<ScoreMeterMask | null> | null = null

/**
 * getScoreMeterMask: load the bitmap once and read its mask; null when it fails to load. Cached,
 * so every caller shares the one read.
 */
export function getScoreMeterMask(): Promise<ScoreMeterMask | null> {
  if (!meterMaskPromise) {
    meterMaskPromise = new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        try { resolve(readScoreMeterMask(img)) }
        catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = SCORE_METER_URL
    })
  }
  return meterMaskPromise
}
