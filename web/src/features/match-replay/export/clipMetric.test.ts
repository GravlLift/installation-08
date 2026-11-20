// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
import { describe, expect, it } from 'vitest'

import { CLIP_GRID, CLIP_LEVEL, CLIP_WARN_PCT, clippedPct, clippedSplit, clipWarning, summarizeClipping, type ClipCells, type ClipSample } from './clipMetric'

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

describe('clippedSplit — clipped samples split into lit surface and emission', () => {
  /** 2 x 2 cells over a 320 x 180 frame, bottom row first: `lum` and `share` per cell. */
  const cells = (lum: number[], share: number[], clipAt = 1): ClipCells => ({ x: 2, y: 2, lum, share, clipAt })
  // The left half of the frame white, the right half black.
  const half = frame(320, 180, (x) => (x < 160 ? [255, 255, 255] : [0, 0, 0]))

  it('counts a clipped sample as surface when its cell is lit surface that reaches the clip level', () => {
    expect(clippedSplit(half, 320, 180, cells([2, 0, 2, 0], [1, 1, 1, 1]))).toEqual({ surfacePct: 50, emissionPct: 0 })
  })

  it('counts it as emission when the cell is mostly light given off, or its surface alone does not clip', () => {
    expect(clippedSplit(half, 320, 180, cells([2, 0, 2, 0], [0.2, 1, 0.2, 1]))).toEqual({ surfacePct: 0, emissionPct: 50 })
    // A dim wall under a white explosion: the opaque scene there is far under the clip level.
    expect(clippedSplit(half, 320, 180, cells([0.1, 0, 0.1, 0], [1, 1, 1, 1]))).toEqual({ surfacePct: 0, emissionPct: 50 })
  })

  it('reads the cells bottom row first against the image top row first', () => {
    // The top half of the image white; only the TOP cells (indices 2, 3) are clipping surface.
    const top = frame(320, 180, (_x, y) => (y < 90 ? [255, 255, 255] : [0, 0, 0]))
    expect(clippedSplit(top, 320, 180, cells([0, 0, 2, 2], [1, 1, 1, 1]))).toEqual({ surfacePct: 50, emissionPct: 0 })
    expect(clippedSplit(top, 320, 180, cells([2, 2, 0, 0], [1, 1, 1, 1]))).toEqual({ surfacePct: 0, emissionPct: 50 })
  })
})

describe('summarizeClipping — the split parts', () => {
  it('sums each part on its own, and leaves them out when no sample carries them', () => {
    const s = (i: number, clippedPct: number, surfaceClippedPct?: number, emissionClippedPct?: number): ClipSample => ({ i, frame: i, scriptMs: null, clippedPct, surfaceClippedPct, emissionClippedPct })
    const sum = summarizeClipping([s(0, 1, 0.5, 0.5), s(1, 14, 0.4, 13.6)])
    expect(sum?.maxPct).toBe(14)
    expect(sum?.surface).toMatchObject({ frames: 2, maxPct: 0.5, maxAt: { i: 0 }, warn: false })
    expect(sum?.emission).toMatchObject({ frames: 2, maxPct: 13.6, maxAt: { i: 1 }, warn: true })
    expect(summarizeClipping([s(0, 3)])).not.toHaveProperty('surface')
  })
})