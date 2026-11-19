// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * scoreMeter.ts — fill the score bars with the game's own meter bitmap (ScoreMeter.png).
 *
 * CONFIRMED (from the game's center scoreboard screen, cusc fb8c6614, and the decoded bitmap):
 * the HUD set carries ScoreMeter.png, served at /static/weapons-assets/halo_infinite/hud/
 * ScoreMeter.png (the same folder as ShieldQuad.png). It is 1600x256 and a channel-packed
 * MASK, not colors: B is the bar's rounded-rectangle shape (about 255 inside, about 150 in the
 * margin around it), G is a striped ramp rising from left to right (uneven: row 128 reads 0 at
 * x=0, about 70 at x=200..800, about 229 at x=1200), R is constant, and A is 255. The game draws
 * each team's fill as a two-tone meter of this bitmap whose meter value is the team's score
 * fraction: one tone is fully transparent, the other is the team color, and the right team's
 * quad has bitmap_flipx = 1 (mirrored).
 *
 * MEASURED 2026-11-19: G is NOT a left-to-right ramp. Averaged over 50-px columns it repeats a
 * sawtooth every 200 px (about 96 -> 134, then 104 -> 142, ...), rising only from about 96 to
 * 191 across the width: a striped texture. A G threshold therefore fills nothing below a quarter
 * of the score (seen on export frames).
 *
 * INFERRED (stated here): the fill is revealed by position along the bar (the meter's x), growing
 * from the bitmap's RIGHT end, which for the left bar is the screen's center (today's left bar
 * fills from the center); the right bar uses the mirrored bitmap, so it also fills from the
 * center. G modulates the fill's strength, 0.45 + 0.55 x G/255, for the stripes. The shape's
 * alpha is clamp((B - 150) / 105, 0, 1).
 */

/** The game's score meter bitmap, served by the app (the HUD folder, cf. `SHIELD_QUAD_URL`). */
export const SCORE_METER_URL = '/static/weapons-assets/halo_infinite/hud/ScoreMeter.png'

/** A meter mask read from the bitmap: the G (ramp) and B (shape) channels, row-major. */
export interface ScoreMeterMask {
  width: number
  height: number
  g: Uint8ClampedArray
  b: Uint8ClampedArray
}

/**
 * meterPixelAlpha: one mask pixel's alpha at a fill fraction (0..1). `u` is the pixel's x in the
 * mask, 0 (left) to 1 (right). The pixel is filled when u >= 1 - fill (the fill grows from the
 * right end); then its alpha is the shape's, clamp((B - 150) / 105, 0, 1), times the stripe
 * strength 0.45 + 0.55 x G/255; unfilled, 0.
 */
export function meterPixelAlpha(u: number, g: number, b: number, fill: number): number {
  if (fill <= 0 || u < 1 - fill) return 0
  const shape = Math.min(1, Math.max(0, (b - 150) / 105))
  return shape * (0.45 + 0.55 * (g / 255))
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
      const alpha = meterPixelAlpha((mx + 0.5) / mask.width, mask.g[i], mask.b[i], fill)
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
 * readScoreMeterMask: draw `img` scaled to `width` x `height` and read its G (ramp) and B (shape)
 * channels. A null 2d context (no canvas, e.g. a headless test) yields a zero mask.
 */
export function readScoreMeterMask(img: HTMLImageElement, width = 400, height = 64): ScoreMeterMask {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return { width: 0, height: 0, g: new Uint8ClampedArray(0), b: new Uint8ClampedArray(0) }
  ctx.clearRect(0, 0, width, height)
  ctx.drawImage(img, 0, 0, width, height)
  const data = ctx.getImageData(0, 0, width, height).data
  const g = new Uint8ClampedArray(width * height)
  const b = new Uint8ClampedArray(width * height)
  for (let i = 0; i < width * height; i++) {
    // The channels of the bitmap: G is the ramp, B the shape (A is 255 everywhere, so it is not the shape).
    g[i] = data[i * 4 + 1]
    b[i] = data[i * 4 + 2]
  }
  return { width, height, g, b }
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
