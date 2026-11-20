// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { make3dPainter, MINIMAP_SHARE, minimapBox, paintTags, TAG_VIEWER_CSS_HEIGHT, tagScale, type Export3dInk } from './export3dFrame'
import type { ExportFormat } from './exportFormats'
import type { ExportTag3d } from './replay3dExportStore'
import { registerReplay3DExport, replay3DExportEntry, type Replay3DExportSource } from './replay3dExportStore'
import { initialView3dChoice, view3dRunOptions } from './view3dChoice'

const source: Replay3DExportSource = {
  players: [],
  beginExport: vi.fn(),
  exportFrame: vi.fn(),
  exportTags: () => [],
  exportPendingLoads: () => null,
  endExport: vi.fn(),
}

describe('minimapBox', () => {
  it('places the map bottom-right, at its share of width and its aspect ratio', () => {
    const box = minimapBox({ width: 960, height: 540 }, { width: 1920, height: 1080 })
    expect(box.width).toBeCloseTo(960 * MINIMAP_SHARE)
    expect(box.height).toBeCloseTo((960 * MINIMAP_SHARE * 9) / 16)
    expect(box.x + box.width).toBe(960 - 16)
    expect(box.y + box.height).toBe(540 - 16)
  })

  it('a map with no width gives no box', () => {
    expect(minimapBox({ width: 960, height: 540 }, { width: 0, height: 0 }).height).toBe(0)
  })
})

describe('replay3dExportStore', () => {
  it('registers and unregisters the view', () => {
    const release = registerReplay3DExport({ source, live: true, camera: 'fp', pov: null })
    expect(replay3DExportEntry()?.source).toBe(source)
    release()
    expect(replay3DExportEntry()).toBeNull()
  })

  it('a stale unregister does not remove the following registration', () => {
    const first = registerReplay3DExport({ source, live: true, camera: 'fp', pov: null })
    const second = registerReplay3DExport({ source, live: false, camera: 'tp', pov: 'x' })
    first()
    expect(replay3DExportEntry()?.camera).toBe('tp')
    second()
    expect(replay3DExportEntry()).toBeNull()
  })
})

describe('tagScale — the on-screen share of the frame', () => {
  it('is one CSS px in logical px, and holds at every file height', () => {
    // 1080p at its 2x density, the 540 format at 1x, 4K at 4x: same scale, same on-screen look.
    expect(tagScale(1080, 2)).toBeCloseTo(540 / TAG_VIEWER_CSS_HEIGHT, 9)
    expect(tagScale(540, 1)).toBeCloseTo(tagScale(1080, 2), 9)
    expect(tagScale(2160, 4)).toBeCloseTo(tagScale(1080, 2), 9)
  })
})

describe('paintTags — exported name tags', () => {
  const ink: Export3dInk = { background: 'rgb(0 0 0)', foreground: 'rgb(255 255 255)' }
  const deps = { ink, font: 'F', format: { width: 1920, height: 1080 } }
  const pixelRatio = 2

  /** A spied 2D context recording each fill with its alpha, and the box heights. */
  function spied() {
    const fonts: string[] = []
    const ops: { op: string; alpha: number; h: number }[] = []
    let alpha = 1
    const ctx = {
      textBaseline: '',
      textAlign: '',
      fillStyle: '',
      measureText: (t: string) => ({ width: t.length * 10 }),
      beginPath: () => {},
      set font(f: string) { fonts.push(f) },
      get font() { return fonts[fonts.length - 1] ?? '' },
      set globalAlpha(a: number) { alpha = a },
      get globalAlpha() { return alpha },
      roundRect: (_x: number, _y: number, _w: number, h: number) => ops.push({ op: 'box', alpha, h }),
      fill: () => ops.push({ op: 'fill', alpha, h: 0 }),
      fillRect: (_x: number, _y: number, _w: number, h: number) => ops.push({ op: 'border', alpha, h }),
      fillText: () => ops.push({ op: 'text', alpha, h: 0 }),
    }
    return { ctx, fonts, ops }
  }

  it('paints each tag at its distance opacity: the 70% background rides the fade, text and border do too', () => {
    const { ctx, ops } = spied()
    const tags: ExportTag3d[] = [
      { x: 100, y: 100, name: 'A', color: '#f00', opacity: 1 },
      { x: 200, y: 200, name: 'B', color: '#0f0', opacity: 0.5 },
    ]
    paintTags(ctx as never, tags, pixelRatio, deps as never)
    expect(ops.map((o) => `${o.op}@${o.alpha.toFixed(2)}`)).toEqual([
      'box@0.70', 'fill@0.70', 'border@1.00', 'text@1.00', // full tag
      'box@0.35', 'fill@0.35', 'border@0.50', 'text@0.50', // faded tag
    ])
  })

  it('sizes the tag to the frame, not to the 540 layout: the on-screen 16 px box at a 900 px-tall viewer', () => {
    const { ctx, fonts, ops } = spied()
    paintTags(ctx as never, [{ x: 100, y: 100, name: 'A', color: '#f00', opacity: 1 }], pixelRatio, deps as never)
    const s = tagScale(1080, pixelRatio)
    expect(parseFloat(fonts[0])).toBeCloseTo(12 * s, 9) // 12 px CSS font, scaled to the frame
    const h = ops.find((o) => o.op === 'box')!.h
    expect(h).toBeCloseTo(16 * s, 9)
    // In file pixels the box keeps the screen's fraction of the frame height: 16/900.
    expect((h * pixelRatio) / 1080).toBeCloseTo(16 / TAG_VIEWER_CSS_HEIGHT, 9)
  })

  it('no tags, no paint', () => {
    const { ctx, ops } = spied()
    paintTags(ctx as never, [], pixelRatio, deps as never)
    expect(ops).toEqual([])
  })
})

describe('make3dPainter — the frame\'s composition', () => {
  const format: ExportFormat = { id: '1080p', width: 1920, height: 1080 }
  const ink: Export3dInk = { background: 'rgb(0 0 0)', foreground: 'rgb(255 255 255)' }
  const map2d = vi.fn((() => ({ width: 100, height: 50 })) as unknown as (frame: number) => CanvasImageSource & { width: number; height: number })
  const overlay = vi.fn()

  /** A canvas context where every method is a no-op, every property is writable, and every method call is recorded. */
  function fakeCtx(): { ctx: CanvasRenderingContext2D; calls: string[] } {
    const calls: string[] = []
    const target = {} as Record<PropertyKey, unknown>
    return {
      calls,
      ctx: new Proxy(target, {
        get: (t, k) => {
          if (typeof k === 'string') calls.push(k)
          if (k === 'measureText') return () => ({ width: 10 })
          return k in t ? (t[k] as never) : () => {}
        },
        set: (t, k, v) => {
          t[k] = v
          return true
        },
      }) as unknown as CanvasRenderingContext2D,
    }
  }

  function deps(clean?: boolean) {
    return {
      source,
      format,
      pixelRatio: 2,
      ink,
      font: 'F',
      map2d,
      overlay,
      clean,
    } as const
  }

  beforeEach(() => {
    map2d.mockClear()
    overlay.mockClear()
    vi.mocked(source.exportFrame).mockClear()
  })

  it('paints the 3D frame, the tags, the minimap and the overlay', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const { ctx, calls } = fakeCtx()
    spy.mockReturnValue(ctx as never)
    source.exportTags = () => [{ x: 100, y: 100, name: 'A', color: '#f00', opacity: 1 }]
    try {
      make3dPainter(deps())(7)
    } finally {
      source.exportTags = () => []
    }
    expect(source.exportFrame).toHaveBeenCalledWith(7)
    // Tags (fillText), minimap (roundRect + a second drawImage) and overlay all ran.
    expect(calls).toContain('fillText')
    expect(calls.filter((c) => c === 'roundRect').length).toBeGreaterThanOrEqual(2)
    expect(calls.filter((c) => c === 'drawImage').length).toBe(2)
    expect(map2d).toHaveBeenCalledWith(7)
    expect(overlay).toHaveBeenCalled()
  })

  it('CLEAN: the bare 3D frame only, no tags, minimap, HUD or panels', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const { ctx, calls } = fakeCtx()
    spy.mockReturnValue(ctx as never)
    make3dPainter(deps(true))(7)
    expect(source.exportFrame).toHaveBeenCalledWith(7) // the 3D image is still drawn
    // The ONE drawImage is the 3D frame itself; no tag, box, text or panel was painted.
    expect(calls.filter((c) => c === 'drawImage')).toEqual(['drawImage'])
    expect(calls).not.toContain('fillText')
    expect(calls).not.toContain('roundRect')
    expect(map2d).not.toHaveBeenCalled()
    expect(overlay).not.toHaveBeenCalled()
  })

  it('MOTION BLUR: hands the file frame\'s subframes to the scene, and paints the tags once', () => {
    const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
    const { ctx, calls } = fakeCtx()
    spy.mockReturnValue(ctx as never)
    const subs = [
      { frame: 6.9, render: true, center: false },
      { frame: 7, render: false, center: true },
      { frame: 7.1, render: true, center: false },
    ]
    const asked: (number | undefined)[] = []
    let tagsRead = 0
    source.exportTags = () => { tagsRead++; return [{ x: 100, y: 100, name: 'A', color: '#f00', opacity: 1 }] }
    try {
      const paint = make3dPainter({ ...deps(), subframes: (_f, index) => { asked.push(index); return index === undefined ? null : subs } })
      paint(7, 3)
      expect(source.exportFrame).toHaveBeenLastCalledWith(7, subs)
      // A frame painted without its file index is a single pose: the plain call, one argument.
      paint(7)
      expect(vi.mocked(source.exportFrame).mock.lastCall).toEqual([7])
    } finally {
      source.exportTags = () => []
    }
    expect(asked).toEqual([3, undefined])
    expect(tagsRead).toBe(2) // once per file frame, not per subframe
    expect(calls.filter((c) => c === 'fillText')).toHaveLength(2)
  })
})

describe('view3dChoice', () => {
  it('starts from what the screen shows, minimap included', () => {
    const entry = { source, live: true, camera: 'tp' as const, pov: 'x1' }
    expect(initialView3dChoice(entry)).toEqual({ on: true, camera: 'tp', pov: 'x1', minimap: true })
    expect(initialView3dChoice(null).on).toBe(false)
  })

  it('exports in 3D only if 3D is both chosen AND loaded', () => {
    const entry = { source, live: true, camera: 'fp' as const, pov: null }
    const choice = { on: true, camera: 'free' as const, pov: 'x2', minimap: false }
    expect(view3dRunOptions(entry, choice)).toEqual({ camera: 'free', pov: 'x2', minimap: false })
    expect(view3dRunOptions(null, choice)).toBeNull()
    expect(view3dRunOptions(entry, { ...choice, on: false })).toBeNull()
  })
})
