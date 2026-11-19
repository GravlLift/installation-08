// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * shieldChaseArt.test.ts — the tint of the game's chase-band bitmap: every pixel becomes the
 * band's tint rgb(255, 129, 129) at the pixel's own alpha, the canvas cached per image and the
 * data URL cached with it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { tintedChase, tintedChaseUrl } from './shieldChaseArt'

afterEach(() => vi.restoreAllMocks())

const CHASE_W = 940
const CHASE_H = 64

/**
 * Stubs `document.createElement('canvas')` with a canvas backed by a pixel buffer: `drawImage`
 * copies the given source image in, `getImageData`/`putImageData` read and write the buffer,
 * and `toDataURL` is a recording function.
 */
function stubCanvas(source: Uint8ClampedArray, toDataURL: () => string): Uint8ClampedArray {
  const buffer = new Uint8ClampedArray(source.length)
  const ctx = {
    drawImage: () => { buffer.set(source) },
    getImageData: () => ({ data: buffer }),
    putImageData: (data: { data: Uint8ClampedArray }) => { buffer.set(data.data) },
  }
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
    tag === 'canvas' ? ({ width: 0, height: 0, toDataURL, getContext: () => ctx } as unknown as HTMLElement) : ({} as HTMLElement))
  return buffer
}

/** The pixel at (x, y) of a tinted canvas buffer. */
function px(buffer: Uint8ClampedArray, x: number, y: number): [number, number, number, number] {
  const i = (y * CHASE_W + x) * 4
  return [buffer[i], buffer[i + 1], buffer[i + 2], buffer[i + 3]]
}

describe('tintedChase: the band tint at the pixel own alpha', () => {
  it('tints the pixels to rgb(255, 129, 129), keeping each own alpha', () => {
    const source = new Uint8ClampedArray(CHASE_W * CHASE_H * 4)
    const set = (x: number, y: number, r: number, g: number, b: number, a: number) => {
      const i = (y * CHASE_W + x) * 4
      source[i] = r; source[i + 1] = g; source[i + 2] = b; source[i + 3] = a
    }
    set(0, 0, 255, 0, 90, 77) // the bitmap's data channels, a dimmer interior alpha
    set(1, 0, 255, 0, 128, 195) // a bright rim pixel, its ramp mid-way
    set(2, 0, 0, 0, 0, 0) // nothing drawn: alpha stays 0
    const buffer = stubCanvas(source, vi.fn(() => 'data:image/png;base64,x'))
    tintedChase({} as HTMLImageElement)
    expect(px(buffer, 0, 0)).toEqual([255, 129, 129, 77])
    expect(px(buffer, 1, 0)).toEqual([255, 129, 129, 195])
    expect(px(buffer, 2, 0)).toEqual([255, 129, 129, 0])
  })

  it('returns the same canvas for the same image', () => {
    stubCanvas(new Uint8ClampedArray(CHASE_W * CHASE_H * 4), vi.fn(() => 'data:image/png;base64,x'))
    const img = {} as HTMLImageElement
    expect(tintedChase(img)).toBe(tintedChase(img))
  })
})

describe('tintedChaseUrl: the data URL the live SVG uses', () => {
  it('is the tinted canvas toDataURL, built once per image', () => {
    const toDataURL = vi.fn(() => 'data:image/png;base64,x')
    stubCanvas(new Uint8ClampedArray(CHASE_W * CHASE_H * 4), toDataURL)
    const img = {} as HTMLImageElement
    expect(tintedChaseUrl(img)).toBe('data:image/png;base64,x')
    expect(tintedChaseUrl(img)).toBe('data:image/png;base64,x')
    expect(toDataURL).toHaveBeenCalledOnce()
  })
})
