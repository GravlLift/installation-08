// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * exportFormats.test.ts — the format catalog and the geometry it imposes.
 *
 * What is locked in: dimensions H.264 accepts (even), an EXACT 16:9, a density that falls
 * back exactly on the pixel for the format (the canvas is sized by `Math.round`), and an
 * unknown identifier that falls back to the default rather than to a formatless export.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EXPORT_FORMAT_ID,
  DEFAULT_EXPORT_FRAMING,
  EXPORT_FORMAT_IDS,
  EXPORT_FORMATS,
  EXPORT_LAYOUT,
  exportFormatOf,
  exportLayoutFor,
} from './exportFormats'

describe('exportFormats — the catalog', () => {
  it('offers exactly 1080p (default) then 720p', () => {
    expect(EXPORT_FORMAT_IDS).toEqual(['1080p', '720p'])
    expect(DEFAULT_EXPORT_FORMAT_ID).toBe('1080p')
    expect(exportFormatOf('1080p')).toMatchObject({ width: 1920, height: 1080 })
    expect(exportFormatOf('720p')).toMatchObject({ width: 1280, height: 720 })
  })

  it('only outputs even dimensions, in exact 16:9', () => {
    for (const f of EXPORT_FORMATS) {
      expect(f.width % 2).toBe(0)
      expect(f.height % 2).toBe(0)
      expect(f.width * 9).toBe(f.height * 16)
    }
    expect(EXPORT_LAYOUT.width * 9).toBe(EXPORT_LAYOUT.height * 16)
  })

  it('an unknown, absent or empty identifier falls back to the default', () => {
    for (const id of ['4k', '', null, undefined, '1080P']) {
      expect(exportFormatOf(id).id).toBe(DEFAULT_EXPORT_FORMAT_ID)
    }
  })
})

describe('exportLayoutFor — the render geometry', () => {
  it('the logical frame rendered at its density falls back AT THE PIXEL on the format', () => {
    for (const f of EXPORT_FORMATS) {
      const l = exportLayoutFor(f)
      // Same rounding as the canvas's sizing (`ReplayCanvas.draw`).
      expect(Math.round(l.width * l.pixelRatio)).toBe(f.width)
      expect(Math.round(l.height * l.pixelRatio)).toBe(f.height)
    }
  })

  it('the two formats share the same layout: only the density changes', () => {
    const [a, b] = EXPORT_FORMATS.map((f) => exportLayoutFor(f))
    expect({ w: a.width, h: a.height }).toEqual({ w: b.width, h: b.height })
    expect(a.pixelRatio).toBe(2)
    expect(b.pixelRatio).toBeCloseTo(4 / 3, 12)
  })

  it('framing: the whole map by default, the requested framing otherwise', () => {
    expect(DEFAULT_EXPORT_FRAMING).toBe('whole')
    expect(exportLayoutFor(exportFormatOf('1080p')).framing).toBe('whole')
    expect(exportLayoutFor(exportFormatOf('720p'), 'current').framing).toBe('current')
  })

  it('does not depend on the screen\'s density', () => {
    const before = exportLayoutFor(exportFormatOf('1080p'))
    const dpr = window.devicePixelRatio
    Object.defineProperty(window, 'devicePixelRatio', { value: 3, configurable: true })
    try {
      expect(exportLayoutFor(exportFormatOf('1080p'))).toEqual(before)
    } finally {
      Object.defineProperty(window, 'devicePixelRatio', { value: dpr, configurable: true })
    }
  })
})
