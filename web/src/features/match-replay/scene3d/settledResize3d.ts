// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * settledResize3d.ts — the 3D view's drawing buffers follow the window's size once it has settled.
 *
 * Resizing the renderer and its post-processing composer reallocates every full-screen render
 * target (the scene, ambient occlusion, bloom, outline, SMAA). A window dragged by its edge, or
 * moved to a monitor of another display scale (which resizes it), reports a stream of sizes; doing
 * that reallocation for each one is a burst of GPU allocations on a machine that may already be
 * short of them. The canvas's CSS box and the camera's aspect follow every size at once (cheap,
 * the image stretches for a moment); the buffers are reallocated once, `settleMs` after the last.
 */

export const RESIZE_SETTLE_MS = 150

export interface ResizeTimers {
  set(fn: () => void, ms: number): unknown
  clear(handle: unknown): void
}

const browserTimers: ResizeTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

export class SettledResize {
  private handle: unknown = null
  private pending: { width: number; height: number } | null = null
  private applied = false
  private readonly preview: (width: number, height: number) => void
  private readonly apply: (width: number, height: number) => void
  private readonly settleMs: number
  private readonly timers: ResizeTimers

  /**
   * `preview` runs for every size (CSS box, camera aspect); `apply` reallocates the buffers, at
   * once for the first size, then only after `settleMs` without a new one.
   */
  constructor(
    preview: (width: number, height: number) => void,
    apply: (width: number, height: number) => void,
    settleMs = RESIZE_SETTLE_MS,
    timers: ResizeTimers = browserTimers,
  ) {
    this.preview = preview
    this.apply = apply
    this.settleMs = settleMs
    this.timers = timers
  }

  request(width: number, height: number): void {
    if (width <= 0 || height <= 0) return
    this.pending = { width, height }
    if (!this.applied) {
      this.flush()
      return
    }
    this.preview(width, height)
    if (this.handle !== null) this.timers.clear(this.handle)
    this.handle = this.timers.set(() => this.flush(), this.settleMs)
  }

  /** flush applies the pending size now, if any. */
  flush(): void {
    if (this.handle !== null) this.timers.clear(this.handle)
    this.handle = null
    const p = this.pending
    if (!p) return
    this.pending = null
    this.applied = true
    this.apply(p.width, p.height)
  }

  /** cancel drops a pending size (the view is torn down). */
  cancel(): void {
    if (this.handle !== null) this.timers.clear(this.handle)
    this.handle = null
    this.pending = null
  }
}

/**
 * screenPixelRatio: the renderer's pixel ratio for the screen it is on now. The console knob wins;
 * otherwise the window's current device pixel ratio, capped at 2. Read each frame, so moving the
 * window to a monitor of another display scale draws at that monitor's density instead of the one
 * the view opened on.
 */
export function screenPixelRatio(knob: number | null, devicePixelRatio: number): number {
  return knob ?? Math.min(devicePixelRatio || 1, 2)
}
