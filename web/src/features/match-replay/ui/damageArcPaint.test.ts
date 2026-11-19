// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * damageArcPaint.test.ts — the pixels behind the HUD's directional damage indicator: the
 * reveal of the game's DamageArc bitmap (ramp vs meter, quantized and cached) and the
 * ring's placement (center, bearing rotation, age fade, hit pulse).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DAMAGE_ARC_MS, type DamageArc } from '../model/damageArcs'
import { DAMAGE_ARC_CENTER, DAMAGE_ARC_REFERENCE_H, paintDamageArcs, revealedArc } from './damageArcPaint'

afterEach(() => vi.restoreAllMocks())

const ARC_W = 720
const ARC_H = 390

/**
 * Stubs `document.createElement('canvas')` with a canvas backed by a pixel buffer: `drawImage`
 * copies the given source image in, `getImageData`/`putImageData` read and write the buffer.
 */
function stubCanvas(source: Uint8ClampedArray): Uint8ClampedArray {
  const buffer = new Uint8ClampedArray(source.length)
  const ctx = {
    drawImage: () => { buffer.set(source) },
    getImageData: () => ({ data: buffer }),
    putImageData: (data: { data: Uint8ClampedArray }) => { buffer.set(data.data) },
  }
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
    tag === 'canvas' ? ({ width: 0, height: 0, getContext: () => ctx } as unknown as HTMLElement) : ({} as HTMLElement))
  return buffer
}

/** The pixel at (x, y) of a revealed canvas buffer. */
function px(buffer: Uint8ClampedArray, x: number, y: number): [number, number, number, number] {
  const i = (y * ARC_W + x) * 4
  return [buffer[i], buffer[i + 1], buffer[i + 2], buffer[i + 3]]
}

/** A recording context: every `drawImage` is captured with the alpha and compositing in effect. */
function recordingCtx() {
  const state: Record<string, unknown> = {}
  const draws: { args: unknown[]; alpha: number; composite: string }[] = []
  const calls: Record<string, unknown[][]> = {}
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop === 'drawImage') return (...args: unknown[]) => {
        draws.push({ args, alpha: (target.globalAlpha as number) ?? 1, composite: (target.globalCompositeOperation as string) ?? 'source-over' })
        calls.drawImage = [...(calls.drawImage ?? []), args]
        return undefined
      }
      if (typeof prop === 'string' && prop in target) return target[prop]
      return (...args: unknown[]) => { (calls[prop as string] ??= []).push(args); return undefined }
    },
    set(target, prop, value) { target[prop as string] = value; return true },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, draws, named: (name: string) => calls[name] ?? [] }
}

describe('revealedArc: the ramp reveal of the bitmap', () => {
  it('keeps the pixels at or below the meter as red, clearing the rest', () => {
    const source = new Uint8ClampedArray(ARC_W * ARC_H * 4)
    const set = (x: number, y: number, r: number, g: number, b: number, a: number) => {
      const i = (y * ARC_W + x) * 4
      source[i] = r; source[i + 1] = g; source[i + 2] = b; source[i + 3] = a
    }
    set(0, 0, 10, 20, 100, 200) // ramp 100/255 < 0.5: kept
    set(1, 0, 10, 20, 250, 200) // ramp 250/255 > 0.5: cleared
    set(2, 0, 9, 9, 9, 0) // nothing drawn: untouched
    const buffer = stubCanvas(source)
    revealedArc({} as HTMLImageElement, 0.5)
    expect(px(buffer, 0, 0)).toEqual([255, 0, 0, 200]) // red, its own alpha kept
    expect(px(buffer, 1, 0)[3]).toBe(0) // beyond the reveal: transparent
    expect(px(buffer, 2, 0)).toEqual([9, 9, 9, 0])
  })

  it('quantizes the meter to 1/32 and caches per image and step', () => {
    stubCanvas(new Uint8ClampedArray(ARC_W * ARC_H * 4))
    const img = {} as HTMLImageElement
    // 0.5 and 0.51 quantize to the same step: the same canvas comes back.
    expect(revealedArc(img, 0.5)).toBe(revealedArc(img, 0.51))
    // A different step (17/32) builds a different canvas.
    expect(revealedArc(img, 0.532)).not.toBe(revealedArc(img, 0.5))
  })
})

describe('paintDamageArcs: the ring on the screen', () => {
  it('draws nothing when the image is not loaded', () => {
    const { ctx, draws } = recordingCtx()
    paintDamageArcs(ctx, [{ bearingDeg: 0, ageMs: 0, by: 1, meter: 0.5, pulseMs: 0 }], { x: 100, y: 100 }, 2160, null)
    expect(draws).toEqual([])
  })

  it('draws nothing for an arc past its lifetime', () => {
    stubCanvas(new Uint8ClampedArray(ARC_W * ARC_H * 4))
    const { ctx, draws } = recordingCtx()
    const arc: DamageArc = { bearingDeg: 0, ageMs: DAMAGE_ARC_MS, by: 1, meter: 0.5, pulseMs: DAMAGE_ARC_MS }
    paintDamageArcs(ctx, [arc], { x: 100, y: 100 }, 2160, {} as HTMLImageElement)
    expect(draws).toEqual([])
  })

  it('centers the ring on the screen, rotated to the bearing, faded by the age', () => {
    stubCanvas(new Uint8ClampedArray(ARC_W * ARC_H * 4))
    const { ctx, draws, named } = recordingCtx()
    const arc: DamageArc = { bearingDeg: 90, ageMs: 500, by: 1, meter: 0.5, pulseMs: 700 }
    const img = {} as HTMLImageElement
    paintDamageArcs(ctx, [arc], { x: 960, y: 540 }, DAMAGE_ARC_REFERENCE_H, img)
    expect(named('translate')).toEqual([[960, 540]])
    expect(named('rotate')[0][0]).toBeCloseTo(Math.PI / 2, 12)
    // One draw (no pulse past 633 ms), the bitmap at native scale, its ring center on the screen center.
    expect(draws).toHaveLength(1)
    const [image, dx, dy, dw, dh] = draws[0].args as [unknown, number, number, number, number]
    // The drawn source is the revealed canvas the module built from the image.
    expect(image).toBe(revealedArc(img, 0.5))
    const scale = DAMAGE_ARC_REFERENCE_H / DAMAGE_ARC_REFERENCE_H
    expect(dx).toBeCloseTo(-DAMAGE_ARC_CENTER.x * scale, 12)
    expect(dy).toBeCloseTo(-DAMAGE_ARC_CENTER.y * scale, 12)
    expect(dw).toBeCloseTo(ARC_W * scale, 12)
    expect(dh).toBeCloseTo(ARC_H * scale, 12)
    // The age fade: 1 - ageMs / lifetime.
    expect(draws[0].alpha).toBeCloseTo(1 - 500 / DAMAGE_ARC_MS, 12)
  })

  it('carries the hit pulse for the first 633 ms, additive and fading', () => {
    stubCanvas(new Uint8ClampedArray(ARC_W * ARC_H * 4))
    const { ctx, draws } = recordingCtx()
    const arc: DamageArc = { bearingDeg: 0, ageMs: 100, by: 1, meter: 0.5, pulseMs: 100 }
    paintDamageArcs(ctx, [arc], { x: 960, y: 540 }, DAMAGE_ARC_REFERENCE_H, {} as HTMLImageElement)
    // The main draw plus the pulse.
    expect(draws).toHaveLength(2)
    const [main, pulse] = draws
    expect(main.composite).toBe('source-over')
    expect(pulse.composite).toBe('lighter')
    // The pulse: opacity * 0.5 * (1 - pulseMs / 300), scaled up about the ring center.
    const opacity = 1 - 100 / DAMAGE_ARC_MS
    expect(pulse.alpha).toBeCloseTo(opacity * 0.5 * (1 - 100 / 300), 12)
    const growth = 1 + 0.2 * (100 / 633)
    const [, dx, , dw] = pulse.args as [unknown, number, number, number]
    expect(dx).toBeCloseTo(-DAMAGE_ARC_CENTER.x * growth, 12)
    expect(dw).toBeCloseTo(ARC_W * growth, 12)
    // Past the pulse window: the main draw alone.
    const quiet: DamageArc = { ...arc, ageMs: 700, pulseMs: 700 }
    const { ctx: ctx2, draws: draws2 } = recordingCtx()
    paintDamageArcs(ctx2, [quiet], { x: 960, y: 540 }, DAMAGE_ARC_REFERENCE_H, {} as HTMLImageElement)
    expect(draws2).toHaveLength(1)
  })
})
