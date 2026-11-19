// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldChaseArt.ts — the pixels behind the shield bar's chase band.
 *
 * The game draws the band (`SHIELD_CHASE_URL`, the `shield_chase` meter quad) as a two-tone
 * meter: the R/G/B channels are data (the B channel is a left-to-right reveal ramp) and the
 * visible color is the tint rgb(255, 129, 129) at the pixel's own alpha, blended additively.
 * This module tints the decoded bitmap the way the game does, once per image; the live HUD
 * uses the canvas as an SVG image source (`tintedChaseUrl`) and the export draws it onto the
 * canvas (`tintedChase`).
 */
/** The band's tint rgb(255, 129, 129) as numbers: `SHIELD_CHASE_INK` from the screen tag. */
const TINT_R = 255
const TINT_G = 129
const TINT_B = 129

/** The bitmap's own size, in pixels (a straight RGBA decode of the game asset). */
const CHASE_W = 940
const CHASE_H = 64

/** The tinted canvases, cached per image: a frame never rebuilds pixels it already built. */
const tintedCache = new Map<object, HTMLCanvasElement>()

/**
 * tintedChase: a 940x64 canvas of the image with every pixel written as (255, 129, 129, A),
 * A the pixel's own alpha. Cached per image, built once.
 */
export function tintedChase(img: HTMLImageElement | ImageBitmap): HTMLCanvasElement {
  let canvas = tintedCache.get(img)
  if (canvas) return canvas
  canvas = buildTinted(img)
  tintedCache.set(img, canvas)
  return canvas
}

function buildTinted(img: HTMLImageElement | ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = CHASE_W
  canvas.height = CHASE_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas
  ctx.drawImage(img, 0, 0, CHASE_W, CHASE_H)
  const data = ctx.getImageData(0, 0, CHASE_W, CHASE_H)
  const px = data.data
  for (let i = 0; i < px.length; i += 4) {
    px[i] = TINT_R
    px[i + 1] = TINT_G
    px[i + 2] = TINT_B
    // the alpha (px[i + 3]) stays the pixel's own
  }
  ctx.putImageData(data, 0, 0)
  return canvas
}

/** The tinted canvas as a PNG data URL (the live SVG's `image` href), cached with the canvas. */
const urlCache = new Map<HTMLCanvasElement, string>()

export function tintedChaseUrl(img: HTMLImageElement | ImageBitmap): string {
  const canvas = tintedChase(img)
  let url = urlCache.get(canvas)
  if (!url) {
    url = canvas.toDataURL('image/png')
    urlCache.set(canvas, url)
  }
  return url
}
