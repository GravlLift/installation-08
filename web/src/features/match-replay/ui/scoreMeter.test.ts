// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * scoreMeter.test.ts — the score meter's pixel math and paint. jsdom has no canvas, so the paint
 * is tested through a stubbed 2d context; the per-pixel decision (`meterPixelAlpha`) is tested
 * directly.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { meterPixelAlpha, paintScoreMeter, readScoreMeterMask } from './scoreMeter'

describe('meterPixelAlpha', () => {
  it('fill 0 fills nothing', () => {
    for (const ramp of [0, 128, 254, 255]) expect(meterPixelAlpha(ramp, 255, 0)).toBe(0)
  })

  it('fill 1 fills every pixel at the shape alpha (A)', () => {
    expect(meterPixelAlpha(0, 255, 1)).toBe(1)
    expect(meterPixelAlpha(128, 141, 1)).toBeCloseTo(141 / 255, 12)
  })

  it('the shape margin (A = 0) is transparent even when filled', () => {
    expect(meterPixelAlpha(230, 0, 1)).toBe(0)
  })

  it('fills from the ramp high end', () => {
    // fill 0.25: the pixels whose ramp (B) is in the top quarter fill, the rest do not.
    expect(meterPixelAlpha(204, 255, 0.25)).toBe(1)
    expect(meterPixelAlpha(178, 255, 0.25)).toBe(0)
  })
})

describe('paintScoreMeter', () => {
  /** A stubbed scratch canvas: the 2d context captures the ImageData it is given. */
  function canvasStub() {
    let captured: Uint8ClampedArray | null = null
    const octx = {
      createImageData: (w: number, h: number) => {
        const data = new Uint8ClampedArray(w * h * 4)
        captured = data
        return { data }
      },
      putImageData: () => {},
    }
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? ({ width: 0, height: 0, getContext: () => octx } as unknown as HTMLElement) : ({} as HTMLElement))
    return { alphaAt: (i: number) => captured![i * 4 + 3], rgbaAt: (i: number) => [captured![i * 4], captured![i * 4 + 1], captured![i * 4 + 2], captured![i * 4 + 3]] }
  }

  function mainCtx() {
    const draws: unknown[][] = []
    const ctx = { drawImage: (...args: unknown[]) => { draws.push(args) } } as unknown as CanvasRenderingContext2D
    return { ctx, draws }
  }

  it('fill 0 draws no filled pixel', () => {
    const mask = { width: 4, height: 1, ramp: new Uint8ClampedArray([0, 64, 128, 255]), shape: new Uint8ClampedArray([255, 255, 255, 255]) }
    const stub = canvasStub()
    const { ctx, draws } = mainCtx()
    paintScoreMeter(ctx, mask, 0, 0, 4, 1, 0, '#ff0000', false)
    for (let i = 0; i < 4; i++) expect(stub.alphaAt(i)).toBe(0)
    expect(draws).toHaveLength(1)
  })

  it('fill 1 draws every shape pixel at the team color', () => {
    const mask = { width: 4, height: 1, ramp: new Uint8ClampedArray([0, 85, 170, 255]), shape: new Uint8ClampedArray([255, 255, 255, 255]) }
    const stub = canvasStub()
    const { ctx } = mainCtx()
    paintScoreMeter(ctx, mask, 0, 0, 4, 1, 1, '#22c55e', false)
    for (let i = 0; i < 4; i++) expect(stub.rgbaAt(i)).toEqual([0x22, 0xc5, 0x5e, 255])
  })

  it('flip mirrors the fill', () => {
    // The bitmap's ramp across 4 pixels: fill 0.75 fills the 3 highest (ramp >= 64).
    const mask = { width: 4, height: 1, ramp: new Uint8ClampedArray([0, 85, 170, 255]), shape: new Uint8ClampedArray([255, 255, 255, 255]) }
    const a = canvasStub()
    paintScoreMeter(mainCtx().ctx, mask, 0, 0, 4, 1, 0.75, '#ffffff', false)
    const up = [0, 1, 2, 3].map((i) => a.alphaAt(i))
    const b = canvasStub()
    paintScoreMeter(mainCtx().ctx, mask, 0, 0, 4, 1, 0.75, '#ffffff', true)
    const dn = [0, 1, 2, 3].map((i) => b.alphaAt(i))
    expect(up).toEqual([0, 255, 255, 255])
    expect(dn).toEqual([255, 255, 255, 0])
  })
})

describe('readScoreMeterMask', () => {
  it('reads the BLUE channel as the ramp and ALPHA as the shape', () => {
    // A 1x1 pixel with distinct RGBA (10, 20, 30, 40): B (30) is the ramp, A (40) the shape.
    const pixel = new Uint8ClampedArray([10, 20, 30, 40])
    const octx = {
      clearRect: () => {},
      drawImage: () => {},
      getImageData: () => ({ data: pixel }),
    }
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? ({ width: 0, height: 0, getContext: () => octx } as unknown as HTMLElement) : ({} as HTMLElement))
    const mask = readScoreMeterMask({} as HTMLImageElement, 1, 1)
    expect(mask.ramp[0]).toBe(30)
    expect(mask.shape[0]).toBe(40)
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})
