// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * clipMetric.ts — THE EXPORT'S CLIPPED-PIXEL CHECK: how much of each exported 3D frame is blown to
 * white, measured on the frame as encoded (after tone mapping, grade and film look; before the HUD),
 * on a sampled grid, and summed up for the clip's camera track (`<name>.camera.json`).
 *
 * A pixel counts as clipped when ALL THREE channels are at or above `CLIP_LEVEL` (220 of 255).
 * Not 250: the view's grade multiplies red by 0.93 (`postFx3d.GRADE_GAIN`), so the default view's
 * pure white is (237, 255, 255) and a test at 250 never fires. 220 is where the default view meets
 * its detail floor (`highlightCeiling3d.DETAIL_FLOOR_LUMINANCE`, a white surface under the full
 * sun, about 15 screen code values per stop left): it draws that grey at (220, 241, 253). A pixel
 * past it on every channel is white with little or no shading left in it.
 *
 * `CLIP_WARN_PCT` (2 % of the frame, about a 200 x 200 block at 1080p, a Spartan's torso in a medium
 * shot) is where the export warns. Measured at this level on the exports on disk (2026-11-20, the
 * decoded mp4s at 2 frames a second): the no-look tracking shot demo-3-track peaks at 0.76 %; the pregame crane shot
 * Jordan flagged as blown out (demo-3-recharge-pregame, before the highlight ceiling) at 4.3 %.
 *
 * Cost: `CLIP_GRID` (160 x 90 = 14,400 samples) reads of pixels the export already holds in memory
 * (`exportReadback3d`), well under a millisecond a frame.
 */

/** A pixel is clipped when its three channels are all at or above this (0..255). */
export const CLIP_LEVEL = 220
/** The export warns when a frame's clipped share exceeds this (percent of the frame). */
export const CLIP_WARN_PCT = 2
/** The sampled grid: columns and rows, sampled at each cell's center. */
export const CLIP_GRID = { x: 160, y: 90 } as const

/**
 * clippedPct: the percentage (0..100) of a frame's sampled pixels that are clipped. `data` is RGBA,
 * row by row, `width` x `height` (an `ImageData`'s layout). 0 for an empty frame.
 */
export function clippedPct(data: ArrayLike<number>, width: number, height: number, grid: { x: number; y: number } = CLIP_GRID): number {
  if (!(width > 0) || !(height > 0)) return 0
  const gx = Math.min(grid.x, width)
  const gy = Math.min(grid.y, height)
  let clipped = 0
  for (let j = 0; j < gy; j++) {
    const y = Math.floor(((j + 0.5) * height) / gy)
    for (let i = 0; i < gx; i++) {
      const x = Math.floor(((i + 0.5) * width) / gx)
      const o = (y * width + x) * 4
      if (data[o] >= CLIP_LEVEL && data[o + 1] >= CLIP_LEVEL && data[o + 2] >= CLIP_LEVEL) clipped++
    }
  }
  return (100 * clipped) / (gx * gy)
}

/**
 * The highlight meter's cells for one frame (`highlightMeter3d.readCells`): the opaque scene before
 * any transparent effect, reduced to `x` x `y` cells, BOTTOM row first (a render target's order).
 * `lum` is a cell's mean linear luminance over its lit-surface taps (emission marks left out,
 * `emissionMark3d`), `share` the share of its taps that are lit surface, and `clipAt` the
 * luminance from which the frame's chain (with its ceiling gain) draws a grey clipped on every channel.
 */
export interface ClipCells {
  x: number
  y: number
  lum: ArrayLike<number>
  share: ArrayLike<number>
  clipAt: number
}

/** A cell is lit surface when at least this share of its taps is. */
export const SURFACE_CELL_SHARE = 0.5

/**
 * clippedSplit: `clippedPct`'s clipped samples split by what clipped them. SURFACE: the sample's
 * cell is lit surface and that surface alone, as drawn, reaches the clip level (a wall or armor
 * lit past white: what the highlight ceiling answers for). EMISSION: every other clipped sample:
 * light given off (a lamp, an orb's core, the sky) or a transparent effect drawn over the surface
 * (an explosion, a muzzle flash, a beam). The two sum to `clippedPct`. The cell test is coarse
 * (a 64 x 36 grid, about 30 x 30 pixels at 1080p): it attributes a share, not a pixel.
 */
export function clippedSplit(
  data: ArrayLike<number>,
  width: number,
  height: number,
  cells: ClipCells,
  grid: { x: number; y: number } = CLIP_GRID,
): { surfacePct: number; emissionPct: number } {
  if (!(width > 0) || !(height > 0)) return { surfacePct: 0, emissionPct: 0 }
  const gx = Math.min(grid.x, width)
  const gy = Math.min(grid.y, height)
  let surface = 0
  let emission = 0
  for (let j = 0; j < gy; j++) {
    const y = Math.floor(((j + 0.5) * height) / gy)
    // The image is top row first, the cells bottom row first.
    const cy = cells.y - 1 - Math.min(cells.y - 1, Math.floor(((y + 0.5) * cells.y) / height))
    for (let i = 0; i < gx; i++) {
      const x = Math.floor(((i + 0.5) * width) / gx)
      const o = (y * width + x) * 4
      if (!(data[o] >= CLIP_LEVEL && data[o + 1] >= CLIP_LEVEL && data[o + 2] >= CLIP_LEVEL)) continue
      const c = cy * cells.x + Math.min(cells.x - 1, Math.floor(((x + 0.5) * cells.x) / width))
      if (cells.share[c] >= SURFACE_CELL_SHARE && cells.lum[c] >= cells.clipAt) surface++
      else emission++
    }
  }
  const n = gx * gy
  return { surfacePct: (100 * surface) / n, emissionPct: (100 * emission) / n }
}

/** One file frame as the camera track records it: `clippedPct` absent when it was not measured. */
export interface ClipSample {
  i: number
  frame: number
  scriptMs: number | null
  clippedPct?: number
  /** `clippedSplit`'s surface share; absent when the meter was off or the frame unmeasured. */
  surfaceClippedPct?: number
  /** `clippedSplit`'s emission share; absent likewise. */
  emissionClippedPct?: number
}

/** The clip's clipped-pixel summary, written beside its camera track. */
export interface ClipSummary {
  /** `CLIP_LEVEL`, `CLIP_WARN_PCT` and the grid, so a reader knows what was measured. */
  level: number
  warnAbovePct: number
  grid: [number, number]
  /** Frames measured. */
  frames: number
  meanPct: number
  maxPct: number
  /** The file frame of the maximum (the first one if several tie). */
  maxAt: { i: number; frame: number; scriptMs: number | null }
  /** True when `maxPct` exceeds `warnAbovePct`. */
  warn: boolean
  /** The same over `surfaceClippedPct` (lit surfaces past white); absent when no frame was split. */
  surface?: ClipPart
  /** The same over `emissionClippedPct` (light given off, transparent effects); absent likewise. */
  emission?: ClipPart
}

/** One part of the split summed up over the clip. */
export interface ClipPart {
  frames: number
  meanPct: number
  maxPct: number
  maxAt: { i: number; frame: number; scriptMs: number | null }
  /** True when `maxPct` exceeds the summary's `warnAbovePct`. */
  warn: boolean
}

/** partOf: one field of the samples summed up, null when no sample carries it. */
function partOf(samples: readonly (ClipSample | undefined)[], pick: (s: ClipSample) => number | undefined): ClipPart | null {
  let n = 0
  let sum = 0
  let max: { s: ClipSample; v: number } | null = null
  for (const s of samples) {
    const v = s ? pick(s) : undefined
    if (!s || typeof v !== 'number' || !Number.isFinite(v)) continue
    n++
    sum += v
    if (!max || v > max.v) max = { s, v }
  }
  if (!max || n === 0) return null
  return {
    frames: n,
    meanPct: sum / n,
    maxPct: max.v,
    maxAt: { i: max.s.i, frame: max.s.frame, scriptMs: max.s.scriptMs },
    warn: max.v > CLIP_WARN_PCT,
  }
}

/** summarizeClipping: the summary of the measured frames of a track, null when none was measured. */
export function summarizeClipping(samples: readonly (ClipSample | undefined)[]): ClipSummary | null {
  const all = partOf(samples, (s) => s.clippedPct)
  if (!all) return null
  const surface = partOf(samples, (s) => s.surfaceClippedPct)
  const emission = partOf(samples, (s) => s.emissionClippedPct)
  return {
    level: CLIP_LEVEL,
    warnAbovePct: CLIP_WARN_PCT,
    grid: [CLIP_GRID.x, CLIP_GRID.y],
    frames: all.frames,
    meanPct: all.meanPct,
    maxPct: all.maxPct,
    maxAt: all.maxAt,
    warn: all.warn,
    ...(surface ? { surface } : {}),
    ...(emission ? { emission } : {}),
  }
}

/** clipWarning: the console line for a summary over the threshold, null otherwise. */
export function clipWarning(summary: ClipSummary | null): string | null {
  if (!summary?.warn) return null
  const at = summary.maxAt
  const when = at.scriptMs !== null ? `script ${Math.round(at.scriptMs)} ms` : `film frame ${at.frame.toFixed(1)}`
  return `[replay-export] ${summary.maxPct.toFixed(1)} % of file frame ${at.i} (${when}) is clipped to white (all channels >= ${summary.level}); mean ${summary.meanPct.toFixed(2)} % over ${summary.frames} frames, warning above ${summary.warnAbovePct} %`
}
