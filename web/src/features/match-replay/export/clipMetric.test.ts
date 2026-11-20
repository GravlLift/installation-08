// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { CLIP_GRID, CLIP_LEVEL, CLIP_WARN_PCT, clippedPct, clipWarning, summarizeClipping, type ClipSample } from './clipMetric'

/** An RGBA frame filled by `color(x, y)`. */
function frame(width: number, height: number, color: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      data.set([...color(x, y), 255], o)
    }
  }
  return data
}

describe('clippedPct — the share of a frame clipped to white', () => {
  it('is 100 for white, 0 for black, and counts the default view\'s own white (237, 255, 255)', () => {
    expect(clippedPct(frame(320, 180, () => [255, 255, 255]), 320, 180)).toBe(100)
    expect(clippedPct(frame(320, 180, () => [0, 0, 0]), 320, 180)).toBe(0)
    expect(clippedPct(frame(320, 180, () => [237, 255, 255]), 320, 180)).toBe(100)
  })

  it('needs all three channels at CLIP_LEVEL: a saturated or slightly darker pixel does not count', () => {
    expect(clippedPct(frame(320, 180, () => [CLIP_LEVEL, CLIP_LEVEL, CLIP_LEVEL]), 320, 180)).toBe(100)
    expect(clippedPct(frame(320, 180, () => [CLIP_LEVEL - 1, 255, 255]), 320, 180)).toBe(0)
    expect(clippedPct(frame(320, 180, () => [255, 255, 40]), 320, 180)).toBe(0)
    // The demo-3 armor chest as exported (208, 222, 226) sat just under it.
    expect(clippedPct(frame(320, 180, () => [208, 222, 226]), 320, 180)).toBe(0)
  })

  it('measures the share on the grid: the left quarter white is 25 %', () => {
    const w = 1920
    const h = 1080
    expect(clippedPct(frame(w, h, (x) => (x < w / 4 ? [250, 250, 250] : [30, 30, 30])), w, h)).toBe(25)
  })

  it('samples at most CLIP_GRID points, and the whole frame when it is smaller', () => {
    expect(CLIP_GRID.x * CLIP_GRID.y).toBe(14400)
    const tiny = frame(4, 2, (x, y) => (x === 0 && y === 0 ? [255, 255, 255] : [0, 0, 0]))
    expect(clippedPct(tiny, 4, 2)).toBe(12.5)
    expect(clippedPct(new Uint8ClampedArray(0), 0, 0)).toBe(0)
  })
})

describe('summarizeClipping — the clip summary in the camera track', () => {
  const sample = (i: number, clippedPct?: number, scriptMs: number | null = i * 16): ClipSample => ({ i, frame: 100 + i, scriptMs, clippedPct })

  it('reports the mean, the max and the file frame of the max, and warns above CLIP_WARN_PCT', () => {
    const s = summarizeClipping([sample(0, 0.5), sample(1, 4.25), sample(2, 1.25), sample(3, 4.25)])!
    expect(s.frames).toBe(4)
    expect(s.meanPct).toBeCloseTo(2.5625, 10)
    expect(s.maxPct).toBe(4.25)
    expect(s.maxAt).toEqual({ i: 1, frame: 101, scriptMs: 16 })
    expect(s.warn).toBe(true)
    expect(s.level).toBe(CLIP_LEVEL)
    expect(s.warnAbovePct).toBe(CLIP_WARN_PCT)
    expect(s.grid).toEqual([CLIP_GRID.x, CLIP_GRID.y])
    expect(clipWarning(s)).toContain('file frame 1 (script 16 ms)')
  })

  it('skips frames without a measure, and is null when none was measured', () => {
    const s = summarizeClipping([sample(0), undefined, sample(2, 1)])!
    expect(s.frames).toBe(1)
    expect(s.warn).toBe(false)
    expect(clipWarning(s)).toBeNull()
    expect(summarizeClipping([sample(0), undefined])).toBeNull()
    expect(clipWarning(null)).toBeNull()
  })

  it('names the film frame when the export is not a camera script', () => {
    expect(clipWarning(summarizeClipping([sample(0, 9, null)]))).toContain('film frame 100.0')
  })
})
