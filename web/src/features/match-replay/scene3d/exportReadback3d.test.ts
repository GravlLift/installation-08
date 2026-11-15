import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ExportReadback3d, type ReadbackGl } from './exportReadback3d'

/** jsdom has no ImageData: the shape the readback uses. */
class FakeImageData {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray
  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.data = new Uint8ClampedArray(width * height * 4)
  }
}

/** A 2D context that keeps what was put into its canvas. */
function fakeContext() {
  const ctx = {
    canvas: null as unknown as HTMLCanvasElement,
    put: [] as Uint8ClampedArray[],
    putImageData(image: FakeImageData) { ctx.put.push(image.data.slice()) },
  }
  return ctx
}

/** A drawing buffer `width` x `height` whose every byte of row y (WebGL order, bottom first) is `fill(y)`. */
function fakeGl(width: number, height: number, fill: (y: number) => number, lost = false) {
  const reads: number[][] = []
  const gl = {
    drawingBufferWidth: width,
    drawingBufferHeight: height,
    RGBA: 0x1908,
    UNSIGNED_BYTE: 0x1401,
    isContextLost: () => lost,
    readPixels: (x: number, y: number, w: number, h: number, _f: number, _t: number, out: Uint8Array) => {
      reads.push([x, y, w, h])
      for (let row = 0; row < h; row++) out.fill(fill(row), row * w * 4, (row + 1) * w * 4)
    },
  }
  return { gl: gl as unknown as ReadbackGl, reads }
}

describe('ExportReadback3d', () => {
  let ctx: ReturnType<typeof fakeContext>
  beforeEach(() => {
    vi.stubGlobal('ImageData', FakeImageData)
    ctx = fakeContext()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      ctx.canvas = this
      return ctx as never
    })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('reads the whole drawing buffer and turns it upright (WebGL rows run bottom first)', () => {
    const readback = new ExportReadback3d()
    const { gl, reads } = fakeGl(2, 3, (y) => 10 + y)
    const canvas = readback.read(gl)
    expect(reads).toEqual([[0, 0, 2, 3]])
    expect(canvas).toBe(ctx.canvas)
    expect([canvas.width, canvas.height]).toEqual([2, 3])
    const rows = [0, 1, 2].map((y) => ctx.put[0][y * 8])
    expect(rows).toEqual([12, 11, 10]) // top row of the image = last row WebGL returns
  })

  it('every call reads the buffer again: a frame is never a copy of the previous one', () => {
    // The 2026-11-15 freeze: the WebGL canvas handed to drawImage kept serving its first image.
    const readback = new ExportReadback3d()
    readback.read(fakeGl(4, 2, () => 1).gl)
    readback.read(fakeGl(4, 2, () => 2).gl)
    expect(ctx.put.map((p) => p[0])).toEqual([1, 2])
  })

  it('keeps its canvas between frames of one size, and follows a new size', () => {
    const readback = new ExportReadback3d()
    const first = readback.read(fakeGl(4, 2, () => 1).gl)
    expect(readback.read(fakeGl(4, 2, () => 1).gl)).toBe(first)
    const resized = readback.read(fakeGl(6, 3, () => 1).gl)
    expect([resized.width, resized.height]).toEqual([6, 3])
    expect(ctx.put[2].length).toBe(6 * 3 * 4)
  })

  it('a lost context fails the export instead of encoding black frames', () => {
    const readback = new ExportReadback3d()
    const { gl, reads } = fakeGl(4, 2, () => 1, true)
    expect(() => readback.read(gl)).toThrow(/lost its WebGL context/)
    expect(reads).toEqual([])
  })
})
