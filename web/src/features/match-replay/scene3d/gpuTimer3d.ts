// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.
/**
 * gpuTimer3d.ts — the GPU time of the 3D view's draws, from `EXT_disjoint_timer_query_webgl2`.
 *
 * The script time of a frame (`profilRendu3d`) only covers submitting the draws; a frame bound by
 * the GPU (fill, triangles, shadow maps) shows its cost here. One TIME_ELAPSED query wraps the
 * frame's draws (shadows, composer, minimap); results arrive a few frames later and are smoothed.
 * Without the extension (some browsers expose it only behind a flag) `ms` stays null.
 */
import type * as THREE from 'three'

/** How many queries may be in flight; a frame finding none free is not measured. */
const POOL = 4
const SMOOTHING = 0.2

interface TimerExt {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

export class GpuTimer {
  /** The smoothed GPU time of the measured frames (ms); null until one is read or without the extension. */
  ms: number | null = null
  private readonly gl: WebGL2RenderingContext | null
  private readonly ext: TimerExt | null
  private readonly free: WebGLQuery[] = []
  private readonly pending: WebGLQuery[] = []
  private active: WebGLQuery | null = null

  constructor(renderer: THREE.WebGLRenderer) {
    const gl = typeof renderer.getContext === 'function' ? renderer.getContext() : null
    this.gl = gl && 'createQuery' in gl ? (gl as WebGL2RenderingContext) : null
    this.ext = this.gl ? (this.gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null) : null
  }

  /** begin starts timing the frame's draws (nothing without the extension or a free query). */
  begin(): void {
    const gl = this.gl
    if (!gl || !this.ext || this.active) return
    this.collect()
    const q = this.free.pop() ?? (this.pending.length + 1 < POOL ? gl.createQuery() : null)
    if (!q) return
    gl.beginQuery(this.ext.TIME_ELAPSED_EXT, q)
    this.active = q
  }

  /** end stops timing; the result is read at a later frame. */
  end(): void {
    const gl = this.gl
    if (!gl || !this.ext || !this.active) return
    gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    this.pending.push(this.active)
    this.active = null
  }

  dispose(): void {
    const gl = this.gl
    if (!gl) return
    if (this.active && this.ext) gl.endQuery(this.ext.TIME_ELAPSED_EXT)
    for (const q of [...this.free, ...this.pending, ...(this.active ? [this.active] : [])]) gl.deleteQuery(q)
    this.free.length = this.pending.length = 0
    this.active = null
  }

  /** collect reads the finished queries, oldest first; a disjoint GPU (clock change) drops them. */
  private collect(): void {
    const gl = this.gl as WebGL2RenderingContext
    const ext = this.ext as TimerExt
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean
    while (this.pending.length > 0) {
      const q = this.pending[0]
      if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break
      this.pending.shift()
      const ns = gl.getQueryParameter(q, gl.QUERY_RESULT) as number
      this.free.push(q)
      if (disjoint) continue
      const ms = ns / 1e6
      this.ms = this.ms === null ? ms : this.ms + (ms - this.ms) * SMOOTHING
    }
  }
}
